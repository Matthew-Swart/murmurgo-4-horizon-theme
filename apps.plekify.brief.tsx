/**
 * App Proxy Route: /apps/plekify/brief
 *
 * Journey Canvas — a two-zone interface: Chat (left/drawer) + Canvas (right/primary).
 * Accessed via Shopify app proxy. GET = page render, POST = chat + canvas actions.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { useLoaderData } from "@remix-run/react";
import db from "../db.server";
import { BriefingService } from "../services/briefing/BriefingService";
import { getTranscriptionService } from "../services/briefing/TranscriptionService";
import {
  getSignalExtractionService,
  type MvbFields,
} from "../services/briefing/SignalExtractionService";

// ─── Types ───────────────────────────────────────────────────────────────────

interface EntityLink {
  name: string;
  handle: string;
  matched: boolean;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  entities?: EntityLink[];
}

interface MvbProgress {
  completeness: number;
  destinations: string[];
  occasion?: string;
  group_size?: number;
  travel_window?: string;
  budget_style?: string;
}

interface Destination {
  id: string;
  name: string;
  nights?: number;
  locked: boolean;
}

interface PlaceCard {
  id: string;
  name: string;
  rating?: number;
  reviews_count?: number;
  location?: string;
  images: string[];
  image?: string;
  style?: string;
  shopify_handle?: string;
  shopify_product_id?: string;
  youtubeVideos?: { url: string; type: "embed" | "channel" }[];
}

interface DestCards {
  properties: PlaceCard[];
  activities: PlaceCard[];
  dining: PlaceCard[];
  loading: boolean;
}

interface ItineraryDay {
  dayNumber: number;
  date: string;
  destination: string;
  property?: {
    id: string;
    name: string;
    image?: string;
    handle?: string;
  };
  activities: Array<{ id: string; name: string; time?: string }>;
  dining: Array<{ id: string; name: string; time?: string }>;
  notes: string;
}

interface Itinerary {
  title: string;
  days: ItineraryDay[];
  totalNights: number;
  tripStart?: string;
}

// ─── Server helpers ──────────────────────────────────────────────────────────

const BRIEFING_API = "http://localhost:8001";

const execFileAsync = promisify(execFile);

/** Call the local QMD search wrapper (Python) for place retrieval. */
async function runQmdSearch(
  query: string,
  opts: { country?: string; limit?: number; hybrid?: boolean } = {}
): Promise<Array<Record<string, unknown>>> {
  const args = [query, "--json", "--limit", String(opts.limit || 6)];
  if (opts.country) args.push("--country", opts.country);
  if (opts.hybrid) args.push("--hybrid"); // BM25 default, hybrid only when explicitly requested

  try {
    const { stdout } = await execFileAsync(
      "python3",
      ["/var/www/plekify/plekify-data-engine/exporters/qmd_search.py", ...args],
      { timeout: 30000, maxBuffer: 1024 * 1024 }
    );
    return JSON.parse(stdout.trim()) as Array<Record<string, unknown>>;
  } catch (e) {
    console.error("QMD search failed:", e);
    return [];
  }
}


function getBriefingService() {
  return new BriefingService(db.clientBrief);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PROMPT_CARDS = [
  "My parents are turning 70 and we want to surprise them with the trip of a lifetime. Big Five safari, maybe Victoria Falls, finishing at a quiet beach lodge. Budget around $80k for 8 people.",
  "We are relocating to Dubai and have 3 weeks to show our kids (8 and 11) what Africa is about before we leave. Mix of wildlife, culture, and adventure. Malaria-free if possible.",
  "I am planning a proposal. She loves wine, architecture, and giraffes. I need something that looks effortless but is actually meticulously planned. Secret itinerary.",
  "Corporate retreat for 12 executives. 4 nights max. Needs to feel exclusive, with game drives and a private chef. Connectivity for one half-day meeting essential.",
  "Solo photography trip. I want to spend 10 days chasing the best light — Namibia's dunes, Botswana's elephants, maybe the Drakensberg. Off-grid is fine.",
];

/** Search QMD daemon for real places matching destination preferences. */
async function searchPortfolio(destinations: string[]): Promise<Array<Record<string, unknown>>> {
  if (!destinations.length) return [];
  try {
    const query = destinations.join(" ");
    const res = await fetch("http://localhost:8003/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 12, mode: "bm25" }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map((r: any) => ({
      id: r.id || r.place_id || "",
      name: r.name || "Unknown",
      location: r.location || r.city || r.region || "",
      handle: r.shopify_handle || r.id || "",
      image: r.image || (Array.isArray(r.images) ? r.images[0] : ""),
      style: r.style || r.category || "",
    }));
  } catch {
    return [];
  }
}

/** Build the common prompt context for chat replies. */
function buildChatPrompt(
  userMessage: string,
  mvbFields: MvbFields,
  mvbCompleteness: number,
  places: Array<Record<string, unknown>> = []
): { systemPrompt: string; userPrompt: string } {
  const CORE: Array<{ key: keyof MvbFields; label: string }> = [
    { key: "occasion", label: "purpose of the trip" },
    { key: "emotional_outcome", label: "how they want to feel" },
    { key: "group_size", label: "number of travellers" },
    { key: "travel_window", label: "when they plan to travel" },
    { key: "duration", label: "length of the trip" },
    { key: "budget_style", label: "budget approach" },
    { key: "hard_constraints", label: "must-haves or deal-breakers" },
    { key: "logistics_base", label: "where they're travelling from" },
  ];

  const missing = CORE.filter(({ key }) => {
    const v = mvbFields[key];
    return Array.isArray(v) ? v.length === 0 : !v;
  }).map(({ label }) => label);

  const gathered =
    Object.entries(mvbFields)
      .filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as string[]).join(", ") : v}`)
      .join("; ") || "nothing yet";

  const systemPrompt = `You are Sage, a warm and perceptive travel consultant crafting bespoke journeys.

Style:
- Warm, direct, unhurried — never robotic
- Maximum 2–3 sentences per response
- Ask exactly ONE question — never list multiple
- Acknowledge what was shared before asking
- Never use bullet points or numbered lists    /* ── Shortlist Bar ───────────────────────────────────────── */
    .shortlist-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 50;
      background: #ffffff;
      border-top: 1px solid rgba(0,0,0,0.08);
      box-shadow: 0 -4px 20px rgba(0,0,0,0.06);
      padding: 12px 20px;
    }
    .shortlist-inner {
      max-width: 960px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .shortlist-items {
      display: flex;
      gap: 8px;
      flex: 1;
      overflow-x: auto;
      padding-bottom: 2px;
    }
    .shortlist-items::-webkit-scrollbar { height: 3px; }
    .shortlist-items::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 3px; }
    .shortlist-chip {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px 6px 6px;
      background: #f5f2ed;
      border: 1px solid rgba(0,0,0,0.06);
      border-radius: 10px;
      font-size: 13px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .shortlist-chip.locked {
      background: #e8e4de;
      border-color: rgba(139,106,62,0.3);
    }
    .chip-thumb {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      object-fit: cover;
    }
    .chip-name {
      font-weight: 500;
      color: #1a1814;
    }
    .chip-controls {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: 4px;
    }
    .nights-btn {
      padding: 2px 8px;
      border-radius: 12px;
      border: 1px solid rgba(0,0,0,0.1);
      background: #ffffff;
      font-size: 11px;
      color: rgba(26,24,20,0.6);
      cursor: pointer;
      transition: all 0.15s;
    }
    .nights-btn:hover {
      border-color: rgba(139,106,62,0.4);
      color: #8b6a3e;
    }
    .nights-input {
      width: 42px;
      padding: 2px 6px;
      border-radius: 8px;
      border: 1px solid rgba(139,106,62,0.4);
      font-size: 12px;
      text-align: center;
      outline: none;
    }
    .lock-btn {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: none;
      background: transparent;
      font-size: 11px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.5;
      transition: opacity 0.15s;
    }
    .lock-btn:hover { opacity: 1; }
    .lock-btn.is-locked { opacity: 1; color: #8b6a3e; }
    .remove-chip {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: none;
      background: transparent;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      color: rgba(26,24,20,0.35);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .remove-chip:hover { color: #c83232; }
    .shortlist-summary {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }
    .summary-count {
      font-size: 12px;
      color: rgba(26,24,20,0.5);
    }
    .compile-btn {
      padding: 8px 16px;
      background: #1a1814;
      color: #f5f2ed;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .compile-btn:hover { opacity: 0.85; }
`;

  const completePct = Math.round(mvbCompleteness * 100);
  const placesSection = places.length > 0
    ? `\n\nAvailable properties/destinations in our portfolio (reference these naturally using [[Name|handle]] syntax when relevant):\n${places.slice(0, 6).map((p: any) => `- ${p.name} (${p.location || p.city || ''}) [[${p.name}|${p.handle || p.id}]]`).join('\n')}`
    : '';

  const userPrompt = `Client said: "${userMessage}"

Gathered so far: ${gathered}
Priority gaps (ask about the first one naturally): ${missing.slice(0, 3).join(", ") || "none — brief is rich"}
Completeness: ${completePct}%${placesSection}

${
  mvbCompleteness >= 0.75
    ? "The brief is complete enough. Warmly confirm their journey is taking shape and let them know they can build their itinerary."
    : "Continue the conversation. Ask about the first missing gap naturally. Only suggest places from the portfolio above."
}`;

  return { systemPrompt, userPrompt };
}

/** Generate reply via Claude Haiku. */
async function generateChatReplyClaude(
  userMessage: string,
  mvbFields: MvbFields,
  mvbCompleteness: number,
  places: Array<Record<string, unknown>> = []
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "Tell me more — I'm building a picture of your perfect journey.";

  const { systemPrompt, userPrompt } = buildChatPrompt(userMessage, mvbFields, mvbCompleteness, places);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) return "Tell me more — I'm building a picture of your perfect journey.";
    const data = await res.json();
    return data.content?.[0]?.text || "Tell me more about what matters most on this trip.";
  } catch {
    return "Tell me more — I'm building a picture of your perfect journey.";
  }
}

/** Generate reply via Gemini Flash-Lite. */
async function generateChatReplyGemini(
  userMessage: string,
  mvbFields: MvbFields,
  mvbCompleteness: number,
  places: Array<Record<string, unknown>> = []
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return "Tell me more — I'm building a picture of your perfect journey.";

  const { systemPrompt, userPrompt } = buildChatPrompt(userMessage, mvbFields, mvbCompleteness, places);
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }],
        }),
      }
    );
    if (!res.ok) return "Tell me more — I'm building a picture of your perfect journey.";
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Tell me more about what matters most on this trip.";
  } catch {
    return "Tell me more — I'm building a picture of your perfect journey.";
  }
}

/** Dispatch to the configured LLM provider. */
async function generateChatReply(
  userMessage: string,
  mvbFields: MvbFields,
  mvbCompleteness: number,
  places: Array<Record<string, unknown>> = []
): Promise<string> {
  const provider = process.env.LLM_PROVIDER || "gemini";
  if (provider === "gemini") {
    return generateChatReplyGemini(userMessage, mvbFields, mvbCompleteness, places);
  }
  return generateChatReplyClaude(userMessage, mvbFields, mvbCompleteness, places);
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const briefId = url.searchParams.get("id");

  if (action === "status" && briefId) {
    const service = getBriefingService();
    const brief = await service.getBriefById(briefId);
    if (!brief)
      return json({ success: false, error: "Brief not found" }, { status: 404, headers: CORS });
    return json(
      {
        success: true,
        data: {
          id: brief.id,
          identifier: brief.brief_identifier,
          status: brief.status,
          mvbCompleteness: brief.mvb_completeness,
          hasTranscript: !!brief.transcript,
          createdAt: brief.created_at,
          updatedAt: brief.updated_at,
        },
      },
      { headers: CORS }
    );
  }

  if (action === "health") {
    const transcription = getTranscriptionService();
    const extraction = getSignalExtractionService();
    const [transcriptionHealth, extractionHealth] = await Promise.all([
      transcription.healthCheck(),
      extraction.healthCheck(),
    ]);
    return json(
      { success: true, services: { transcription: transcriptionHealth, extraction: extractionHealth } },
      { headers: CORS }
    );
  }

  const shop = url.searchParams.get("shop") || "";
  const themeColor = url.searchParams.get("theme_color") || "dark";
  const siteIdentifier = url.searchParams.get("site") || "plekify";
  const videoUrl = shop.includes("murmurgo")
    ? "https://cdn.shopify.com/videos/c/o/v/131910c2c25b4fb3855e0c19c0202e6d.mp4"
    : "https://cdn.shopify.com/videos/c/o/v/9a699ef836da4143881c5ef33479d146.mp4";

  return json(
    {
      success: true,
      config: {
        promptCards: PROMPT_CARDS,
        maxAudioDuration: 600,
        supportedAudioFormats: ["audio/webm", "audio/mp4", "audio/wav", "audio/ogg"],
        maxAudioSize: 25 * 1024 * 1024,
        videoUrl,
        themeColor,
        siteIdentifier,
      },
    },
    { headers: CORS }
  );
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  try {
    const body = await request.json();
    const { action, briefId, shop = "plekify.myshopify.com", ...data } = body;
    const service = getBriefingService();

    switch (action) {
      // ── Chat: create session ─────────────────────────────────────────────
      case "chat_session_create": {
        const brief = await service.createBrief({
          shop,
          clientName: data.clientName,
          clientEmail: data.clientEmail,
          inputChannel: "web_text",
        });
        return json(
          {
            success: true,
            session_id: brief.id,
            text: "Describe your journey — the more vivid, the better.",
          },
          { status: 201, headers: CORS }
        );
      }

      // ── Chat: send message ───────────────────────────────────────────────
      case "chat_message": {
        if (!briefId || !data.message) {
          return json(
            { success: false, error: "briefId and message required" },
            { status: 400, headers: CORS }
          );
        }

        const brief = await service.getBriefById(briefId);
        if (!brief)
          return json({ success: false, error: "Session not found" }, { status: 404, headers: CORS });

        const newTranscript = brief.transcript
          ? `${brief.transcript}\n\n${data.message}`
          : data.message;

        await service.updateBrief(briefId, { transcript: newTranscript });

        let mvbFields: MvbFields = {};
        let mvbCompleteness = 0;
        let destinations: string[] = [];

        if (newTranscript.trim().length > 30) {
          try {
            const extractionService = getSignalExtractionService();
            const result = await extractionService.extractSignals(newTranscript);
            mvbFields = result.mvbFields;
            mvbCompleteness = result.mvbCompleteness;
            destinations = result.mvbFields.destination_preferences || [];

            await service.updateBrief(briefId, {
              extractedSignals: result.signals as unknown as Record<string, unknown>,
              mvbFields: result.mvbFields as unknown as Record<string, unknown>,
              mvbCompleteness,
            });
          } catch (e) {
            console.error("Signal extraction failed:", e);
          }
        }

        // Search portfolio for real places matching destinations
        let portfolioPlaces: Array<Record<string, unknown>> = [];
        if (destinations.length > 0) {
          portfolioPlaces = await searchPortfolio(destinations);
        }

        const replyText = await generateChatReply(data.message, mvbFields, mvbCompleteness, portfolioPlaces);

        // Parse entity references from AI text: [[Name|handle]]
        const entityRegex = /\[\[([^|\]]+)\|([^|\]]+)\]\]/g;
        const entities: Array<{ name: string; handle: string; matched: boolean }> = [];
        let match;
        while ((match = entityRegex.exec(replyText)) !== null) {
          const name = match[1].trim();
          const handle = match[2].trim();
          const matched = portfolioPlaces.some((p: any) => (p.handle === handle || p.id === handle));
          entities.push({ name, handle, matched });
        }

        // Strip [[...]] markup from displayed text, leaving just the name
        const cleanText = replyText.replace(/\[\[([^|\]]+)\|[^|\]]+\]\]/g, "$1");

        return json(
          {
            success: true,
            text: cleanText,
            raw_text: replyText,
            entities,
            destinations,
            mvb_progress: {
              completeness: mvbCompleteness,
              destinations,
              occasion: mvbFields.occasion,
              group_size: mvbFields.group_size,
              travel_window: mvbFields.travel_window,
              budget_style: mvbFields.budget_style,
            },
            ready: mvbCompleteness >= 0.75,
          },
          { headers: CORS }
        );
      }

      // ── Chat: transcribe audio ───────────────────────────────────────────
      case "chat_transcribe": {
        if (!data.audioData) {
          return json({ success: false, error: "audioData required" }, { status: 400, headers: CORS });
        }
        const transcriptionService = getTranscriptionService();
        const result = await transcriptionService.transcribeFromBase64(
          data.audioData,
          data.mimeType || "audio/webm"
        );
        return json({ success: true, text: result.text }, { headers: CORS });
      }

      // ── Chat: generate itinerary ─────────────────────────────────────────
      case "chat_generate": {
        if (!briefId) {
          return json({ success: false, error: "briefId required" }, { status: 400, headers: CORS });
        }
        const updated = await service.updateStatus(briefId, "pending_review");
        return json(
          {
            success: true,
            brief_id: updated.id,
            brief_identifier: updated.brief_identifier,
            client_view_url: `/apps/plekify/brief?submitted=true&id=${updated.id}`,
          },
          { headers: CORS }
        );
      }

      // ── Canvas: fetch places for a destination category ──────────────────
      case "canvas_places": {
        const { destination_name, category = "accommodation" } = data;
        if (!destination_name) {
          return json({ success: false, error: "destination_name required" }, { status: 400, headers: CORS });
        }

        // QMD direct retrieval (primary source)
        const qmdQuery = destination_name.trim();
        const rawPlaces = await runQmdSearch(qmdQuery, { country: "South Africa", limit: 30 });
        const catLower = category.toLowerCase();
        const qmdPlaces = rawPlaces.filter((p: any) => {
          const style = String(p.style || p.primary_type_display || p.category || "").toLowerCase();
          return style.includes(catLower) || catLower.includes(style) || style === "";
        }).slice(0, 10);
        const normalizedPlaces = qmdPlaces.map((p) => ({
          id: String(p.id || p.place_id || p.pin_id || ""),
          name: String(p.name || "Unknown"),
          rating: typeof p.rating === "number" ? p.rating : undefined,
          reviews_count: typeof p.reviews_count === "number" ? p.reviews_count : undefined,
          location: String(p.location || p.city || p.region || p.country || ""),
          images: Array.isArray(p.images) ? p.images.filter((img: unknown): img is string => typeof img === "string") : [],
          image: String(p.image || (Array.isArray(p.images) && p.images.length ? p.images[0] : "")),
          style: String(p.style || p.category || p.type || ""),
          shopify_handle: p.shopify_handle ? String(p.shopify_handle) : undefined,
          shopify_product_id: p.shopify_product_id ? String(p.shopify_product_id) : undefined,
        }));

        return json({
          success: true,
          places: normalizedPlaces,
          qmd_places: normalizedPlaces,
        }, { headers: CORS });
      }

      // ── Canvas: fetch YouTube videos for a place ─────────────────────────
      case "canvas_videos": {
        const { place_id } = data;
        if (!place_id) {
          return json({ success: false, error: "place_id required" }, { status: 400, headers: CORS });
        }
        try {
          const res = await fetch(
            `${BRIEFING_API}/api/briefing/place/${encodeURIComponent(place_id)}/videos`
          );
          if (!res.ok) return json({ success: false, videos: [] }, { headers: CORS });
          const result = await res.json();
          return json({ success: true, ...result }, { headers: CORS });
        } catch {
          return json({ success: false, videos: [] }, { headers: CORS });
        }
      }

      // ── Get place detail by handle ───────────────────────────────────────
      case "get_place": {
        const { handle } = data;
        if (!handle) {
          return json({ success: false, error: "handle required" }, { status: 400, headers: CORS });
        }
        // Search QMD for the handle
        try {
          const res = await fetch("http://localhost:8003/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: handle, limit: 5, mode: "bm25" }),
          });
          if (!res.ok) return json({ success: false, place: null }, { headers: CORS });
          const qmdData = await res.json();
          const match = (qmdData.results || []).find((r: any) =>
            r.shopify_handle === handle || r.id === handle || r.name === handle
          );
          if (!match) return json({ success: false, place: null }, { headers: CORS });

          return json({
            success: true,
            place: {
              id: match.id || match.place_id || "",
              name: match.name || "",
              location: match.location || match.city || match.region || "",
              image: match.image || (Array.isArray(match.images) ? match.images[0] : ""),
              images: Array.isArray(match.images) ? match.images : [],
              rating: match.rating,
              reviews_count: match.reviews_count,
              style: match.style || match.category || "",
              shopify_handle: match.shopify_handle,
              description: match.description || match.ai_snippet || "",
            },
          }, { headers: CORS });
        } catch {
          return json({ success: false, place: null }, { headers: CORS });
        }
      }

      // ── Legacy actions ───────────────────────────────────────────────────
      case "create": {
        const brief = await service.createBrief({
          shop,
          clientName: data.clientName,
          clientEmail: data.clientEmail,
          clientPhone: data.clientPhone,
          inputChannel: data.inputChannel || "web_text",
        });
        return json(
          { success: true, data: { id: brief.id, identifier: brief.brief_identifier, status: brief.status } },
          { status: 201, headers: CORS }
        );
      }

      default:
        return json({ success: false, error: `Unknown action: ${action}` }, { status: 400, headers: CORS });
    }
  } catch (e) {
    console.error("Action error:", e);
    return json({ success: false, error: "Internal server error" }, { status: 500, headers: CORS });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function cdnUrl(src: string | undefined, _size: "card" | "expanded" | "fullscreen"): string {
  if (!src) return "";
  // Shopify CDN: use as-is (no suffix needed)
  if (src.includes("cdn.shopify.com")) return src;
  // Google lh3 CDN: append size suffix
  const base = src.split("=")[0];
  if (_size === "card") return `${base}=w480-h320`;
  if (_size === "expanded") return `${base}=w800-h533`;
  return `${base}=w1600-h1067`;
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/[?&]v=([^&]+)/);
  return m ? m[1] : null;
}

function traitChips(card: PlaceCard): string[] {
  const chips: string[] = [];
  const style = card.style || "";
  if (/5.star|luxury|premier/i.test(style)) chips.push("5-star");
  else if (/4.star/i.test(style)) chips.push("4-star");
  else if (/lodge|safari/i.test(style)) chips.push("Safari");
  else if (/boutique/i.test(style)) chips.push("Boutique");
  else if (/resort/i.test(style)) chips.push("Resort");
  if (card.rating && card.rating >= 4.8) chips.push("Top-rated");
  return chips.slice(0, 2);
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0a0a0a;
    --surface: #141414;
    --surface2: #1e1e1e;
    --border: rgba(255,255,255,0.08);
    --text: #f0ede6;
    --text-muted: rgba(240,237,230,0.5);
    --accent: #c9a96e;
    --accent-dim: rgba(201,169,110,0.15);
    --locked-bg: rgba(201,169,110,0.2);
    --chip-dashed: rgba(240,237,230,0.25);
    --radius: 12px;
    --chat-w: 320px;
  }
  [data-theme="light"] {
    --bg: #f5f2ed;
    --surface: #ffffff;
    --surface2: #f0ede6;
    --border: rgba(0,0,0,0.1);
    --text: #1a1814;
    --text-muted: rgba(26,24,20,0.5);
    --accent: #8b6a3e;
    --accent-dim: rgba(139,106,62,0.1);
    --locked-bg: rgba(139,106,62,0.15);
    --chip-dashed: rgba(0,0,0,0.2);
  }

  html, body { height: 100%; overflow: hidden; }

  .jc-root {
    display: flex;
    width: 100%;
    height: 100vh;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    overflow: hidden;
  }

  /* ── Chat Zone ────────────────────────────────────────────── */
  .jc-chat {
    width: var(--chat-w);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-right: 1px solid var(--border);
    height: 100vh;
    overflow: hidden;
  }

  .chat-header {
    padding: 20px 20px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .chat-header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  .chat-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
    letter-spacing: 0.01em;
  }
  .chat-controls { display: flex; gap: 6px; }
  .ctrl-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    padding: 4px;
    border-radius: 6px;
    color: var(--text-muted);
    transition: color 0.15s;
  }
  .ctrl-btn:hover { color: var(--text); }

  .mvb-bar {
    height: 2px;
    background: var(--border);
    border-radius: 1px;
    overflow: hidden;
    margin-top: 8px;
  }
  .mvb-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 1px;
    transition: width 600ms ease;
  }
  .mvb-label {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 4px;
    display: flex;
    justify-content: space-between;
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    scroll-behavior: smooth;
  }
  .chat-messages::-webkit-scrollbar { width: 4px; }
  .chat-messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .bubble-wrap { display: flex; }
  .bubble-wrap.user { justify-content: flex-end; }
  .bubble-wrap.assistant { justify-content: flex-start; }
  .bubble {
    max-width: 88%;
    padding: 10px 14px;
    border-radius: 16px;
    font-size: 13.5px;
    line-height: 1.55;
    word-break: break-word;
  }
  .bubble.user {
    background: var(--accent);
    color: #1a1814;
    border-bottom-right-radius: 4px;
  }
  .bubble.assistant {
    background: var(--surface2);
    color: var(--text);
    border-bottom-left-radius: 4px;
  }
  .bubble-typing { display: flex; align-items: center; gap: 4px; padding: 12px 16px; }
  .dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
    animation: bounce 1.2s infinite;
  }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce {
    0%, 60%, 100% { transform: translateY(0); }
    30% { transform: translateY(-6px); }
  }

  .prompt-cards-row {
    padding: 0 12px 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    flex-shrink: 0;
  }
  .prompt-card {
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 11px;
    padding: 5px 10px;
    border-radius: 20px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .prompt-card:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .prompt-card:disabled { opacity: 0.4; cursor: not-allowed; }

  .input-area {
    padding: 10px 12px 12px;
    display: flex;
    gap: 6px;
    align-items: flex-end;
    flex-shrink: 0;
    border-top: 1px solid var(--border);
  }
  .input-wrap { flex: 1; }
  .chat-input {
    width: 100%;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 12px;
    color: var(--text);
    font-size: 13.5px;
    padding: 9px 12px;
    resize: none;
    outline: none;
    font-family: inherit;
    line-height: 1.45;
    transition: border-color 0.15s;
  }
  .chat-input:focus { border-color: var(--accent); }
  .chat-input::placeholder { color: var(--text-muted); }

  .icon-btn {
    width: 34px; height: 34px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 10px;
    cursor: pointer;
    font-size: 15px;
    display: flex; align-items: center; justify-content: center;
    color: var(--text-muted);
    transition: all 0.15s;
    flex-shrink: 0;
  }
  .icon-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .icon-btn.recording { background: rgba(220,50,50,0.15); border-color: #dc3232; color: #dc3232; }
  .icon-btn.send-active { background: var(--accent); border-color: var(--accent); color: #1a1814; }

  /* ── Canvas Zone ──────────────────────────────────────────── */
  .jc-canvas {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }

  .canvas-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    height: 52px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    background: var(--surface);
  }
  .canvas-brand {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .topbar-right { display: flex; align-items: center; gap: 8px; }
  .generate-btn {
    background: var(--accent);
    color: #1a1814;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    padding: 7px 16px;
    cursor: pointer;
    transition: opacity 0.15s;
    white-space: nowrap;
  }
  .generate-btn:hover { opacity: 0.85; }
  .generate-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── Timeline ────────────────────────────────────────────── */
  .timeline-strip {
    padding: 14px 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow-x: auto;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
  }
  .timeline-strip::-webkit-scrollbar { height: 3px; }
  .timeline-strip::-webkit-scrollbar-thumb { background: var(--border); }

  .dest-arrow { color: var(--border); font-size: 16px; flex-shrink: 0; }

  .dest-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
    user-select: none;
  }
  .dest-chip.suggested {
    background: transparent;
    border: 1.5px dashed var(--chip-dashed);
    color: var(--text-muted);
  }
  .dest-chip.suggested:hover { border-color: var(--accent); color: var(--text); }
  .dest-chip.locked {
    background: var(--locked-bg);
    border: 1.5px solid var(--accent);
    color: var(--text);
  }
  .dest-chip.active {
    background: var(--accent);
    border: 1.5px solid var(--accent);
    color: #1a1814;
  }
  .chip-lock { font-size: 10px; opacity: 0.7; }

  .timeline-add-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    border: 1.5px dashed var(--border);
    border-radius: 20px;
    font-size: 12px;
    color: var(--text-muted);
    background: none;
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
  }
  .timeline-add-btn:hover { border-color: var(--accent); color: var(--accent); }

  /* ── Empty / Hint states ─────────────────────────────────── */
  .canvas-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-muted);
    padding: 40px;
    text-align: center;
  }
  .canvas-empty-icon { font-size: 40px; opacity: 0.3; }
  .canvas-empty-title { font-size: 16px; font-weight: 500; }
  .canvas-empty-sub { font-size: 13px; max-width: 280px; line-height: 1.5; }

  /* ── Card grid ───────────────────────────────────────────── */
  .dest-panel {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .dest-panel::-webkit-scrollbar { width: 5px; }
  .dest-panel::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  .dest-panel-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 2px;
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    align-items: start;
  }

  .category-col { display: flex; flex-direction: column; gap: 10px; }
  .category-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }

  /* ── Card compact ────────────────────────────────────────── */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.15s, border-color 0.15s;
    position: relative;
  }
  .card:hover { transform: translateY(-2px); border-color: rgba(201,169,110,0.3); }
  .card.is-locked { border-color: var(--accent); }

  .card-img-wrap {
    position: relative;
    padding-top: 66.66%; /* 3:2 */
    overflow: hidden;
    background: var(--surface2);
  }
  .card-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s;
  }
  .card:hover .card-img { transform: scale(1.04); }
  .card-img-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    opacity: 0.2;
  }

  .card-lock-btn {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 26px; height: 26px;
    background: rgba(0,0,0,0.55);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s;
    z-index: 2;
  }
  .card-lock-btn:hover { background: rgba(0,0,0,0.8); }
  .card-lock-btn.locked { background: var(--accent); color: #1a1814; }

  .yt-badge {
    position: absolute;
    bottom: 6px;
    left: 6px;
    background: rgba(0,0,0,0.7);
    color: #fff;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    display: flex; align-items: center; gap: 3px;
    pointer-events: none;
  }

  .card-body { padding: 9px 10px 10px; }
  .card-name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    margin-bottom: 3px;
  }
  .card-rating {
    font-size: 11px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 3px;
    margin-bottom: 5px;
  }
  .card-rating .star { color: var(--accent); font-size: 10px; }
  .card-traits { display: flex; flex-wrap: wrap; gap: 4px; }
  .card-trait {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 10px;
    background: var(--accent-dim);
    color: var(--accent);
    border: 1px solid rgba(201,169,110,0.2);
  }

  /* ── Card skeleton loader ────────────────────────────────── */
  .card-skeleton {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .skel-img {
    padding-top: 66.66%;
    background: var(--surface2);
    position: relative;
    overflow: hidden;
  }
  .skel-img::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%);
    animation: shimmer 1.5s infinite;
  }
  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
  .skel-body { padding: 10px; display: flex; flex-direction: column; gap: 6px; }
  .skel-line {
    height: 10px;
    border-radius: 5px;
    background: var(--surface2);
    overflow: hidden;
    position: relative;
  }
  .skel-line::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%);
    animation: shimmer 1.5s infinite;
  }

  /* ── Card Expanded Modal ─────────────────────────────────── */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    animation: fadeIn 0.15s ease;
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  .expanded-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    width: 100%;
    max-width: 640px;
    max-height: 85vh;
    overflow-y: auto;
    animation: slideUp 0.2s ease;
  }
  @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  .expanded-card::-webkit-scrollbar { width: 5px; }
  .expanded-card::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  .exp-close {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 32px; height: 32px;
    background: rgba(0,0,0,0.5);
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 16px;
    color: #fff;
    display: flex; align-items: center; justify-content: center;
    z-index: 5;
    transition: background 0.15s;
  }
  .exp-close:hover { background: rgba(0,0,0,0.8); }

  .exp-images {
    display: flex;
    gap: 3px;
    position: relative;
  }
  .exp-img-wrap {
    flex: 1;
    padding-top: 30%;
    position: relative;
    overflow: hidden;
    cursor: zoom-in;
  }
  .exp-img-wrap:first-child { flex: 2; padding-top: 0; height: 200px; }
  .exp-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.2s;
  }
  .exp-img-wrap:hover .exp-img { transform: scale(1.03); }

  .exp-body { padding: 20px; }
  .exp-name { font-size: 20px; font-weight: 700; color: var(--text); margin-bottom: 4px; }
  .exp-meta {
    font-size: 13px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .exp-meta .star { color: var(--accent); }
  .exp-summary {
    font-size: 14px;
    line-height: 1.65;
    color: var(--text-muted);
    margin-bottom: 14px;
  }
  .exp-amenities { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 18px; }
  .exp-amenity {
    font-size: 11.5px;
    padding: 4px 10px;
    border-radius: 12px;
    background: var(--surface2);
    color: var(--text-muted);
    border: 1px solid var(--border);
  }
  .exp-ctas { display: flex; gap: 10px; flex-wrap: wrap; }
  .cta-btn {
    flex: 1;
    min-width: 120px;
    padding: 10px 16px;
    border-radius: 10px;
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
    border: none;
  }
  .cta-btn:hover { opacity: 0.85; }
  .cta-primary { background: var(--accent); color: #1a1814; }
  .cta-secondary { background: var(--surface2); color: var(--text); border: 1px solid var(--border); }
  .cta-video { background: rgba(255,0,0,0.15); color: #ff4444; border: 1px solid rgba(255,0,0,0.2); }
  .cta-yt-link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    color: var(--text-muted);
    text-decoration: none;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    transition: all 0.15s;
  }
  .cta-yt-link:hover { color: var(--accent); border-color: var(--accent); }

  /* ── Gallery Overlay ─────────────────────────────────────── */
  .gallery-overlay {
    position: fixed;
    inset: 0;
    background: #111;
    z-index: 9999;
    overflow-y: auto;
    animation: fadeIn 0.15s ease;
  }
  .gallery-header {
    position: sticky;
    top: 0;
    z-index: 10;
    background: rgba(17,17,17,0.85);
    backdrop-filter: blur(8px);
    padding: 12px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .gallery-badge {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .gallery-name { font-size: 14px; font-weight: 600; color: #f0ede6; }
  .gallery-rating { font-size: 12px; color: rgba(240,237,230,0.6); }
  .gallery-close {
    background: rgba(255,255,255,0.1);
    border: none;
    border-radius: 8px;
    width: 34px; height: 34px;
    cursor: pointer;
    font-size: 18px;
    color: #f0ede6;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s;
  }
  .gallery-close:hover { background: rgba(255,255,255,0.2); }
  .gallery-images { display: flex; flex-direction: column; gap: 0; }
  .gallery-img { width: 100%; display: block; }

  /* ── Video Modal ─────────────────────────────────────────── */
  .video-modal {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.92);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    animation: fadeIn 0.15s ease;
  }
  .video-inner {
    width: 100%;
    max-width: 900px;
    position: relative;
  }
  .video-close {
    position: absolute;
    top: -42px;
    right: 0;
    background: rgba(255,255,255,0.1);
    border: none;
    border-radius: 8px;
    width: 34px; height: 34px;
    cursor: pointer;
    font-size: 18px;
    color: #fff;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s;
  }
  .video-close:hover { background: rgba(255,255,255,0.2); }
  .video-frame-wrap {
    position: relative;
    padding-top: 56.25%; /* 16:9 */
    background: #000;
    border-radius: 10px;
    overflow: hidden;
  }
  .video-frame {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: none;
  }

  /* ── Mobile chat FAB + drawer ────────────────────────────── */
  .chat-fab {
    display: none;
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 52px; height: 52px;
    background: var(--accent);
    border: none;
    border-radius: 50%;
    cursor: pointer;
    font-size: 22px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.35);
    z-index: 100;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s;
  }
  .chat-fab:hover { transform: scale(1.08); }

  .chat-drawer {
    display: none;
    position: fixed;
    bottom: 0; left: 0; right: 0;
    height: 70%;
    background: var(--surface);
    border-top: 1px solid var(--border);
    border-radius: 16px 16px 0 0;
    z-index: 150;
    flex-direction: column;
    box-shadow: 0 -8px 32px rgba(0,0,0,0.4);
    animation: slideUp 0.25s ease;
  }
  .chat-drawer.open { display: flex; }
  .drawer-handle {
    width: 36px; height: 4px;
    background: var(--border);
    border-radius: 2px;
    margin: 10px auto 4px;
    flex-shrink: 0;
  }
  .drawer-close {
    position: absolute;
    top: 10px;
    right: 14px;
    background: none;
    border: none;
    font-size: 18px;
    color: var(--text-muted);
    cursor: pointer;
  }

  /* ── Submitted ───────────────────────────────────────────── */
  .submitted-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px;
    text-align: center;
    gap: 12px;
  }
  .submitted-icon { font-size: 48px; }
  .submitted-title { font-size: 22px; font-weight: 600; color: var(--text); }
  .submitted-body { font-size: 15px; color: var(--text-muted); max-width: 360px; line-height: 1.6; }

  /* ── Responsive ──────────────────────────────────────────── */
  @media (max-width: 1023px) {
    .jc-chat { display: none; }
    .chat-fab { display: flex; }
  }

  @media (max-width: 767px) {
    .card-grid { grid-template-columns: 1fr; }
    .exp-img-wrap:first-child { height: 160px; }
  }

  /* ── Landing State ───────────────────────────────────────── */
  .landing-root {
    position: relative;
    width: 100%;
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    text-align: center;
  }
  .landing-video-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
  }
  .landing-video-bg video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .landing-scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.25) 100%);
    pointer-events: none;
  }
  .landing-content {
    position: relative;
    z-index: 1;
    max-width: 680px;
    width: 100%;
    padding: 0 24px;
  }
  .landing-header {
    background: rgba(255,255,255,0.15);
    backdrop-filter: blur(16px) saturate(180%);
    -webkit-backdrop-filter: blur(16px) saturate(180%);
    border: 1px solid rgba(255,255,255,0.22);
    border-radius: 18px;
    padding: 28px 32px 24px;
    margin-bottom: 20px;
    box-shadow: 0 4px 30px rgba(0,0,0,0.12);
  }
  .landing-title {
    font-size: 3.2rem;
    font-weight: 300;
    color: #ffffff;
    letter-spacing: -0.02em;
    line-height: 1.05;
    margin: 0 0 8px 0;
    text-shadow: 0 1px 3px rgba(0,0,0,0.4), 0 2px 16px rgba(0,0,0,0.25);
  }
  .landing-subtitle {
    font-size: 1.2rem;
    font-weight: 400;
    color: rgba(255,255,255,0.92);
    margin: 0;
    line-height: 1.5;
    text-shadow: 0 1px 2px rgba(0,0,0,0.35);
  }
  .landing-input-wrap {
    position: relative;
    background: rgba(255,255,255,0.95);
    backdrop-filter: blur(20px);
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.18);
    padding: 16px 20px;
    margin-bottom: 20px;
    display: flex;
    align-items: flex-end;
    gap: 10px;
  }
  .landing-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 1.05rem;
    line-height: 1.5;
    color: #1a1814;
    resize: none;
    min-height: 56px;
    max-height: 140px;
    font-family: inherit;
  }
  .landing-input::placeholder { color: rgba(26,24,20,0.45); }
  .landing-input-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
  .landing-input-actions button {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s;
    font-size: 16px;
  }
  .landing-voice-btn {
    background: var(--surface2);
    color: var(--text);
  }
  .landing-voice-btn:hover { background: var(--border); }
  .landing-voice-btn.recording {
    background: rgba(255,0,0,0.15);
    color: #ff4444;
    animation: pulse 1.2s infinite;
  }
  .landing-send-btn {
    background: var(--accent);
    color: #1a1814;
  }
  .landing-send-btn:hover { opacity: 0.85; }
  .landing-send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .landing-prompts {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 640px;
    margin: 0 auto;
  }
  .landing-prompts-label {
    font-size: 0.85rem;
    color: rgba(255,255,255,0.75);
    margin-bottom: 4px;
    text-shadow: 0 1px 2px rgba(0,0,0,0.3);
  }
  .landing-prompt-btn {
    text-align: left;
    padding: 12px 18px;
    background: rgba(255,255,255,0.12);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 12px;
    color: #fff;
    font-size: 0.92rem;
    line-height: 1.4;
    cursor: pointer;
    transition: all 0.2s;
    font-family: inherit;
  }
  .landing-prompt-btn:hover {
    background: rgba(255,255,255,0.22);
    border-color: rgba(255,255,255,0.35);
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.08); }
  }
  @media (max-width: 767px) {
    .landing-title { font-size: 2.2rem; }
    .landing-subtitle { font-size: 1rem; }
    .landing-header { padding: 20px 22px 18px; }
    .landing-prompts { gap: 6px; }
    .landing-prompt-btn { padding: 10px 14px; font-size: 0.85rem; }
  }

  /* ── Entity Links ────────────────────────────────────────── */
  .entity-link {
    color: #8b6a3e;
    text-decoration: underline;
    text-decoration-color: rgba(139,106,62,0.4);
    text-underline-offset: 3px;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.15s;
  }
  .entity-link:hover {
    color: #6b4f2a;
    text-decoration-color: rgba(139,106,62,0.8);
    background: rgba(139,106,62,0.06);
    border-radius: 3px;
  }
  .entity-unmatched {
    color: rgba(26,24,20,0.4);
    text-decoration: none;
    cursor: default;
    font-weight: 400;
  }
  .entity-unmatched:hover {
    color: rgba(26,24,20,0.4);
    background: transparent;
  }

  /* ── Preview Panel ───────────────────────────────────────── */
  .preview-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0,0,0,0.25);
    backdrop-filter: blur(4px);
  }
  .preview-panel {
    position: fixed;
    top: 0;
    right: 0;
    width: 420px;
    max-width: 90vw;
    height: 100vh;
    background: #ffffff;
    box-shadow: -8px 0 40px rgba(0,0,0,0.12);
    overflow-y: auto;
    animation: slideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes slideIn {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
  .preview-close {
    position: absolute;
    top: 16px;
    right: 16px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: rgba(0,0,0,0.06);
    font-size: 20px;
    cursor: pointer;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
  }
  .preview-close:hover { background: rgba(0,0,0,0.12); }
  .preview-hero {
    width: 100%;
    height: 260px;
    overflow: hidden;
    background: #f0ede6;
  }
  .preview-hero img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .preview-body {
    padding: 24px;
  }
  .preview-title {
    font-size: 1.5rem;
    font-weight: 500;
    color: #1a1814;
    margin: 0 0 12px;
    line-height: 1.2;
  }
  .preview-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 16px;
    font-size: 13.5px;
    color: rgba(26,24,20,0.6);
  }
  .preview-style {
    background: rgba(139,106,62,0.1);
    color: #8b6a3e;
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
  }
  .preview-desc {
    font-size: 14.5px;
    line-height: 1.65;
    color: rgba(26,24,20,0.75);
    margin: 0 0 20px;
  }
  .preview-cta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 12px 20px;
    background: #1a1814;
    color: #f5f2ed;
    border-radius: 10px;
    text-decoration: none;
    font-size: 14px;
    font-weight: 500;
    transition: opacity 0.15s;
  }
  .preview-cta:hover { opacity: 0.85; }
  .preview-loading, .preview-empty {
    padding: 80px 24px;
    text-align: center;
    color: rgba(26,24,20,0.4);
    font-size: 15px;
  }
  @media (max-width: 767px) {
    .preview-panel { width: 100%; max-width: 100%; }
  }
  /* ── Chat Phase (single pane) ───────────────────────────── */
  .chat-phase {
    position: relative;
    width: 100%;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #f5f2ed;
  }
  .chat-phase .video-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
  }
  .chat-phase .video-bg video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .chat-phase .video-overlay {
    position: absolute;
    inset: 0;
    background: #f5f2ed;
    z-index: 1;
  }
  .chat-column {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    height: 100vh;
    max-width: 860px;
    width: 100%;
    margin: 0 auto;
    background: transparent;
  }
  .chat-scroll {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 32px 24px 16px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .msg-row {
    display: flex;
    max-width: 85%;
    animation: msgIn 0.3s ease;
  }
  .msg-row.user { align-self: flex-end; }
  .msg-row.assistant { align-self: flex-start; }
  .msg-bubble {
    padding: 16px 20px;
    border-radius: 18px;
    font-size: 15.5px;
    line-height: 1.65;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .msg-bubble.user {
    background: #e8e4de;
    color: #1a1814;
    border-bottom-right-radius: 4px;
  }
  .msg-bubble.assistant {
    background: #ffffff;
    color: #1a1814;
    border: 1px solid rgba(0,0,0,0.07);
    border-bottom-left-radius: 4px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.04);
  }
  .msg-bubble.typing { display: flex; gap: 5px; align-items: center; padding: 18px 22px; }
  .msg-bubble.typing .dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: rgba(26,24,20,0.35);
    animation: typingBounce 1.4s infinite ease-in-out both;
  }
  .msg-bubble.typing .dot:nth-child(1) { animation-delay: -0.32s; }
  .msg-bubble.typing .dot:nth-child(2) { animation-delay: -0.16s; }
  @keyframes typingBounce {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
    40% { transform: scale(1); opacity: 1; }
  }
  @keyframes msgIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .chat-input-wrap {
    flex-shrink: 0;
    padding: 14px 24px 72px;
    background: rgba(255,255,255,0.85);
    backdrop-filter: blur(14px);
    border-top: 1px solid rgba(0,0,0,0.06);
  }
  .chat-input-inner {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    max-width: 860px;
    margin: 0 auto;
  }
  .chat-input-inner textarea {
    flex: 1;
    border: 1px solid rgba(0,0,0,0.12);
    border-radius: 14px;
    padding: 14px 18px;
    font-size: 15px;
    line-height: 1.5;
    resize: none;
    min-height: 52px;
    max-height: 140px;
    background: #ffffff;
    color: #1a1814;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
  }
  .chat-input-inner textarea:focus { border-color: rgba(0,0,0,0.25); }
  .chat-input-inner textarea::placeholder { color: rgba(26,24,20,0.4); }
  .chat-input-inner textarea:disabled { opacity: 0.5; }
  .chat-input-inner button {
    width: 44px; height: 44px;
    border-radius: 50%;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 17px;
    flex-shrink: 0;
    transition: all 0.15s;
  }
  .chat-input-inner .voice-btn {
    background: #edeae5;
    color: #1a1814;
  }
  .chat-input-inner .voice-btn:hover { background: #e0ddd6; }
  .chat-input-inner .voice-btn.recording {
    background: rgba(200,50,50,0.12);
    color: #c83232;
    animation: pulse 1.2s infinite;
  }
  .chat-input-inner .send-btn {
    background: #1a1814;
    color: #f5f2ed;
  }
  .chat-input-inner .send-btn:hover { opacity: 0.85; }
  .chat-input-inner .send-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  /* ── Itinerary View ──────────────────────────────────────── */
  .itinerary-root {
    width: 100%;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: #f5f0e7;
    color: #27211c;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    overflow: hidden;
  }
  .itin-header {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 16px 24px;
    background: #fffdf9;
    border-bottom: 1px solid rgba(39,33,28,0.1);
    flex-shrink: 0;
  }
  .itin-back {
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid rgba(39,33,28,0.15);
    background: transparent;
    color: #27211c;
    font-size: 13.5px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .itin-back:hover {
    background: rgba(39,33,28,0.04);
  }
  .itin-title {
    font-size: 1.35rem;
    font-weight: 500;
    margin: 0;
    font-family: 'Cormorant Garamond', Georgia, serif;
    color: #27211c;
  }
  .itin-meta {
    margin-left: auto;
    font-size: 13px;
    color: rgba(39,33,28,0.55);
  }
  .itin-workspace {
    display: grid;
    grid-template-columns: 200px 1fr 320px;
    flex: 1;
    overflow: hidden;
  }
  .itin-pane {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .itin-pane--nav {
    background: #e8dfd1;
    border-right: 1px solid rgba(39,33,28,0.08);
  }
  .itin-pane--detail {
    background: #fbf7f0;
  }
  .itin-pane--summary {
    background: #f5f0e7;
    border-left: 1px solid rgba(39,33,28,0.08);
  }
  .pane-header {
    padding: 14px 18px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(39,33,28,0.5);
    border-bottom: 1px solid rgba(39,33,28,0.06);
    flex-shrink: 0;
  }
  .day-list {
    overflow-y: auto;
    padding: 8px;
  }
  .day-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    border-radius: 8px;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: all 0.15s;
    font-size: 13.5px;
    color: #27211c;
  }
  .day-item:hover {
    background: rgba(255,255,255,0.5);
  }
  .day-item.active {
    background: #fffdf9;
    box-shadow: 0 1px 4px rgba(39,33,28,0.06);
  }
  .day-num {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(39,33,28,0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .day-item.active .day-num {
    background: #27211c;
    color: #f5f0e7;
  }
  .day-dest {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .day-detail {
    overflow-y: auto;
    padding: 24px;
  }
  .day-property {
    margin-bottom: 24px;
  }
  .prop-hero {
    width: 100%;
    height: 200px;
    object-fit: cover;
    border-radius: 12px;
    margin-bottom: 14px;
  }
  .prop-name {
    font-size: 1.3rem;
    font-weight: 500;
    margin: 0 0 8px;
    font-family: 'Cormorant Garamond', Georgia, serif;
  }
  .prop-link {
    font-size: 13.5px;
    color: #8b6a3e;
    text-decoration: none;
  }
  .prop-link:hover { text-decoration: underline; }
  .day-notes {
    background: #fffdf9;
    padding: 16px 20px;
    border-radius: 10px;
    margin-bottom: 20px;
  }
  .day-notes h4 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(39,33,28,0.5);
    margin: 0 0 8px;
  }
  .day-notes p {
    margin: 0;
    font-size: 14px;
    line-height: 1.6;
    color: rgba(39,33,28,0.8);
  }
  .day-section {
    margin-bottom: 20px;
  }
  .day-section h4 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(39,33,28,0.5);
    margin: 0 0 10px;
  }
  .day-section ul {
    margin: 0;
    padding-left: 18px;
    font-size: 14px;
    line-height: 1.7;
    color: rgba(39,33,28,0.75);
  }
  .trip-summary {
    overflow-y: auto;
    padding: 20px;
  }
  .summary-route {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .route-stop {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
    position: relative;
    font-size: 13.5px;
  }
  .route-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #8b6a3e;
    flex-shrink: 0;
  }
  .route-name {
    flex: 1;
    font-weight: 500;
  }
  .route-nights {
    font-size: 12px;
    color: rgba(39,33,28,0.5);
    background: rgba(39,33,28,0.06);
    padding: 2px 8px;
    border-radius: 10px;
  }
  .route-line {
    position: absolute;
    left: 4px;
    top: 28px;
    width: 2px;
    height: 20px;
    background: rgba(139,106,62,0.25);
  }
  .summary-total {
    display: flex;
    justify-content: space-between;
    padding: 16px 0;
    margin-top: 8px;
    border-top: 1px solid rgba(39,33,28,0.1);
    font-weight: 600;
    font-size: 14px;
  }
  @media (max-width: 1023px) {
    .itin-workspace {
      grid-template-columns: 160px 1fr;
    }
    .itin-pane--summary { display: none; }
  }
  @media (max-width: 767px) {
    .itin-workspace {
      grid-template-columns: 1fr;
    }
    .itin-pane--nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 60px;
      flex-direction: row;
      z-index: 10;
      border-right: none;
      border-top: 1px solid rgba(39,33,28,0.08);
    }
    .day-list {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 8px 12px;
    }
    .day-item {
      white-space: nowrap;
      flex-shrink: 0;
    }
    .pane-header { display: none; }
  }


`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function MessageText({
  text,
  entities,
  onEntityClick,
}: {
  text: string;
  entities?: EntityLink[];
  onEntityClick: (entity: EntityLink) => void;
}) {
  if (!entities || entities.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  // Build regex from entity names (escape special chars)
  const names = entities.map((e) => e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${names.join('|')})`, 'g');
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const entity = entities.find((e) => e.name === match[1]);
    if (!entity) continue;

    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span
        key={match.index}
        className={`entity-link${entity.matched ? '' : ' entity-unmatched'}`}
        onClick={() => onEntityClick(entity)}
        role="button"
        tabIndex={0}
      >
        {match[1]}
      </span>
    );
    lastIndex = match.index + match[1].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

function CardSkeleton() {
  return (
    <div className="card-skeleton">
      <div className="skel-img" />
      <div className="skel-body">
        <div className="skel-line" style={{ width: "70%" }} />
        <div className="skel-line" style={{ width: "45%" }} />
      </div>
    </div>
  );
}

interface CompactCardProps {
  card: PlaceCard;
  locked: boolean;
  onToggleLock: () => void;
  onClick: () => void;
}

function CompactCard({ card, locked, onToggleLock, onClick }: CompactCardProps) {
  const traits = traitChips(card);
  const hasYt = (card.youtubeVideos || []).some((v) => v.type === "embed");

  return (
    <div className={`card${locked ? " is-locked" : ""}`} onClick={onClick}>
      <div className="card-img-wrap">
        {card.image ? (
          <img
            className="card-img"
            src={cdnUrl(card.image, "card")}
            alt={card.name}
            loading="lazy"
          />
        ) : (
          <div className="card-img-placeholder">🏡</div>
        )}
        <button
          className={`card-lock-btn${locked ? " locked" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock();
          }}
          title={locked ? "Unlock" : "Lock this in"}
        >
          {locked ? "🔒" : "○"}
        </button>
        {hasYt && <div className="yt-badge">▶ Video</div>}
      </div>
      <div className="card-body">
        <div className="card-name">{card.name}</div>
        {(card.rating || card.reviews_count) && (
          <div className="card-rating">
            {card.rating && (
              <>
                <span className="star">★</span>
                <span>{card.rating.toFixed(1)}</span>
              </>
            )}
            {card.reviews_count && (
              <span>({card.reviews_count.toLocaleString()})</span>
            )}
          </div>
        )}
        {traits.length > 0 && (
          <div className="card-traits">
            {traits.map((t) => (
              <span key={t} className="card-trait">{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ExpandedCardProps {
  card: PlaceCard;
  locked: boolean;
  onToggleLock: () => void;
  onClose: () => void;
  onOpenGallery: (idx: number) => void;
  onOpenVideo: (url: string) => void;
}

function ExpandedCard({
  card, locked, onToggleLock, onClose, onOpenGallery, onOpenVideo,
}: ExpandedCardProps) {
  const images = card.images.slice(0, 3);
  const embedVideos = (card.youtubeVideos || []).filter((v) => v.type === "embed");
  const channelVideos = (card.youtubeVideos || []).filter((v) => v.type === "channel");

  // Parse summary from a simple body_html-like text — just strip HTML tags
  const summary = card.style || "";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="expanded-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ position: "relative" }}>
          <button className="exp-close" onClick={onClose}>×</button>
          <div className="exp-images">
            {images.length > 0 ? (
              images.map((img, i) => (
                <div
                  key={i}
                  className="exp-img-wrap"
                  style={i > 0 ? {} : {}}
                  onClick={() => onOpenGallery(i)}
                >
                  <img
                    className="exp-img"
                    src={cdnUrl(img, "expanded")}
                    alt={`${card.name} ${i + 1}`}
                    loading="lazy"
                  />
                </div>
              ))
            ) : (
              <div style={{ height: 200, background: "var(--surface2)", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, opacity: 0.2 }}>
                🏡
              </div>
            )}
          </div>
        </div>

        <div className="exp-body">
          <div className="exp-name">{card.name}</div>
          <div className="exp-meta">
            {card.rating && (
              <span>
                <span className="star">★</span> {card.rating.toFixed(1)}
                {card.reviews_count ? ` (${card.reviews_count.toLocaleString()} reviews)` : ""}
              </span>
            )}
            {card.location && <span>📍 {card.location}</span>}
          </div>

          {summary && <div className="exp-summary">{summary}</div>}

          {card.style && (
            <div className="exp-amenities">
              <span className="exp-amenity">{card.style}</span>
            </div>
          )}

          <div className="exp-ctas">
            <button
              className={`cta-btn ${locked ? "cta-primary" : "cta-secondary"}`}
              onClick={onToggleLock}
            >
              {locked ? "✓ Locked in" : "Lock this in"}
            </button>
            <button className="cta-btn cta-secondary" onClick={onClose}>
              Show alternatives
            </button>
            {embedVideos.length > 0 && (
              <button
                className="cta-btn cta-video"
                onClick={() => onOpenVideo(embedVideos[0].url)}
              >
                ▶ Watch video
              </button>
            )}
            {channelVideos.length > 0 && (
              <a
                className="cta-yt-link"
                href={channelVideos[0].url}
                target="_blank"
                rel="noopener noreferrer"
              >
                ↗ Watch on YouTube
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface GalleryOverlayProps {
  card: PlaceCard;
  onClose: () => void;
}

function GalleryOverlay({ card, onClose }: GalleryOverlayProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="gallery-overlay">
      <div className="gallery-header">
        <div className="gallery-badge">
          <span className="gallery-name">{card.name}</span>
          {card.rating && (
            <span className="gallery-rating">★ {card.rating.toFixed(1)}</span>
          )}
          {card.location && (
            <span className="gallery-rating">· {card.location}</span>
          )}
        </div>
        <button className="gallery-close" onClick={onClose}>×</button>
      </div>
      <div className="gallery-images">
        {card.images.map((img, i) => (
          <img
            key={i}
            className="gallery-img"
            src={cdnUrl(img, "fullscreen")}
            alt={`${card.name} ${i + 1}`}
            loading="lazy"
          />
        ))}
      </div>
    </div>
  );
}

interface VideoModalProps {
  videoUrl: string;
  onClose: () => void;
}

function VideoModal({ videoUrl, onClose }: VideoModalProps) {
  const videoId = extractYouTubeId(videoUrl);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!videoId) return null;

  return (
    <div className="video-modal" onClick={onClose}>
      <div className="video-inner" onClick={(e) => e.stopPropagation()}>
        <button className="video-close" onClick={onClose}>×</button>
        <div className="video-frame-wrap">
          <iframe
            className="video-frame"
            src={`https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&autoplay=1`}
            allow="autoplay; encrypted-media"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function JourneyCanvas() {
  const loaderData = useLoaderData<typeof loader>();
  const config = (loaderData as { config?: { promptCards?: string[]; videoUrl?: string; themeColor?: string; siteIdentifier?: string } }).config;
  const promptCards = config?.promptCards ?? PROMPT_CARDS;

  // ── Core chat state ─────────────────────────────────────────────────────────
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [mvbProgress, setMvbProgress] = useState<MvbProgress>({ completeness: 0, destinations: [] });
  const [ready, setReady] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [darkMode, setDarkMode] = useState(config?.themeColor !== "light");

  // ── Canvas state ─────────────────────────────────────────────────────────────
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [activeDestId, setActiveDestId] = useState<string | null>(null);
  const [canvasCards, setCanvasCards] = useState<Record<string, DestCards>>({});
  const [lockedItems, setLockedItems] = useState<Set<string>>(new Set());
  const [lockedDestinations, setLockedDestinations] = useState<Set<string>>(new Set());

  // ── Overlay state ─────────────────────────────────────────────────────────────
  const [expandedCard, setExpandedCard] = useState<PlaceCard | null>(null);
  const [galleryCard, setGalleryCard] = useState<PlaceCard | null>(null);
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  // ── Preview panel state ───────────────────────────────────────────────────────
  const [previewEntity, setPreviewEntity] = useState<EntityLink | null>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ── Trip shortlist ───────────────────────────────────────────────────────────
  interface ShortlistItem {
    id: string;
    name: string;
    type: "destination" | "property" | "activity" | "dining";
    handle?: string;
    image?: string;
    nights?: number;
    locked: boolean; // true = confirmed, false = wishlist
  }

  const [shortlist, setShortlist] = useState<ShortlistItem[]>([]);
  const [editingNights, setEditingNights] = useState<string | null>(null);

  // ── Itinerary state
  const [itineraryView, setItineraryView] = useState(false);
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [activeDay, setActiveDay] = useState(0);

  // ── Refs ──────────────────────────────────────────────────────────────────────
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  // ── Init ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem("plekify_dark");
      if (saved !== null) setDarkMode(saved === "true");
    } catch {}
  }, []);

  useEffect(() => {
    async function createSession() {
      try {
        const res = await fetch(`${window.location.pathname}?_data=${encodeURIComponent("routes/apps.plekify.brief")}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "chat_session_create" }),
        });
        const data = await res.json();
        if (data.success) {
          setSessionId(data.session_id);
          setMessages([{ role: "assistant", text: data.text }]);
        }
      } catch {
        setMessages([{ role: "assistant", text: "Describe your journey — the more vivid, the better." }]);
      }
    }
    createSession();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  // ── Preview panel handlers ────────────────────────────────────────────────
  const closePreview = useCallback(() => {
    setPreviewEntity(null);
    setPreviewData(null);
  }, []);

  const openEntityPreview = useCallback(async (entity: EntityLink) => {
    if (!entity.matched) return;
    setPreviewEntity(entity);
    setPreviewLoading(true);
    setPreviewData(null);
    try {
      const res = await fetch(`${window.location.pathname}?_data=${encodeURIComponent("routes/apps.plekify.brief")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_place", handle: entity.handle }),
      });
      const data = await res.json();
      if (data.success) setPreviewData(data.place);
    } catch {
      setPreviewData(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);


  const addToShortlist = useCallback((item: Omit<ShortlistItem, "locked">, locked = false) => {
    setShortlist((prev) => {
      if (prev.some((p) => p.id === item.id)) return prev;
      return [...prev, { ...item, locked }];
    });
  }, []);

  const toggleLock = useCallback((id: string) => {
    setShortlist((prev) =>
      prev.map((item) => (item.id === id ? { ...item, locked: !item.locked } : item))
    );
  }, []);

  const removeFromShortlist = useCallback((id: string) => {
    setShortlist((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const updateNights = useCallback((id: string, nights: number) => {
    setShortlist((prev) =>
      prev.map((item) => (item.id === id ? { ...item, nights: Math.max(1, nights) } : item))
    );
  }, []);

  // ESC to close overlays
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (previewEntity) closePreview();
        else if (expandedCard) setExpandedCard(null);
        else if (chatOpen) setChatOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expandedCard, chatOpen, previewEntity, closePreview]);

  // ── Fetch cards for a destination ─────────────────────────────────────────
  const fetchCardsForDest = useCallback(async (destName: string, destId: string) => {
    setCanvasCards((prev) => ({
      ...prev,
      [destId]: { properties: [], activities: [], dining: [], loading: true },
    }));

    try {
      const [propsRes, actsRes, dineRes] = await Promise.all([
        fetch(`${window.location.pathname}?_data=${encodeURIComponent("routes/apps.plekify.brief")}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "canvas_places", destination_name: destName, category: "accommodation" }),
        }),
        fetch(`${window.location.pathname}?_data=${encodeURIComponent("routes/apps.plekify.brief")}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "canvas_places", destination_name: destName, category: "activity" }),
        }),
        fetch(`${window.location.pathname}?_data=${encodeURIComponent("routes/apps.plekify.brief")}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "canvas_places", destination_name: destName, category: "dining" }),
        }),
      ]);

      const [propsData, actsData, dineData] = await Promise.all([
        propsRes.json(),
        actsRes.json(),
        dineRes.json(),
      ]);

      // Prefer QMD results when available; fallback to DB (legacy) places
      const pick = (d: { places?: PlaceCard[]; qmd_places?: PlaceCard[] }) =>
        d.qmd_places?.length ? d.qmd_places : (d.places || []);

      setCanvasCards((prev) => ({
        ...prev,
        [destId]: {
          properties: pick(propsData),
          activities: pick(actsData),
          dining: pick(dineData),
          loading: false,
        },
      }));
    } catch {
      setCanvasCards((prev) => ({
        ...prev,
        [destId]: { properties: [], activities: [], dining: [], loading: false },
      }));
    }
  }, []);

  // ── Fetch YouTube videos for a card ──────────────────────────────────────
  const fetchVideosForCard = useCallback(async (card: PlaceCard): Promise<PlaceCard> => {
    try {
      const res = await fetch(`${window.location.pathname}?_data=${encodeURIComponent("routes/apps.plekify.brief")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "canvas_videos", place_id: card.id }),
      });
      const data = await res.json();
      return { ...card, youtubeVideos: data.videos || [] };
    } catch {
      return { ...card, youtubeVideos: [] };
    }
  }, []);

  // ── Select destination ────────────────────────────────────────────────────
  const selectDestination = useCallback((dest: Destination) => {
    setActiveDestId(dest.id);
    if (!canvasCards[dest.id]) {
      fetchCardsForDest(dest.name, dest.id);
    }
  }, [canvasCards, fetchCardsForDest]);

  // ── Update destinations from chat response ────────────────────────────────
  const updateDestinations = useCallback((newNames: string[]) => {
    setDestinations((prev) => {
      const existing = new Map(prev.map((d) => [d.id, d]));
      const updated: Destination[] = [];
      let firstNew: Destination | null = null;

      for (const name of newNames) {
        const id = slugify(name);
        if (existing.has(id)) {
          updated.push(existing.get(id)!);
        } else {
          const nd: Destination = { id, name, locked: false };
          updated.push(nd);
          if (!firstNew) firstNew = nd;
        }
      }

      // Auto-select the first destination if none active
      if (firstNew && !activeDestId) {
        setTimeout(() => selectDestination(firstNew!), 0);
      }

      return updated;
    });
  }, [activeDestId, selectDestination]);

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    const msg = text.trim();
    if (!msg || !sessionId || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: msg }]);
    setInput("");
    setLoading(true);
    setHasStarted(true);

    try {
      const res = await fetch(`${window.location.pathname}?_data=${encodeURIComponent("routes/apps.plekify.brief")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chat_message", briefId: sessionId, message: msg }),
      });
      const data = await res.json();
      if (data.success) {
        setMessages((prev) => [...prev, { role: "assistant", text: data.text, entities: data.entities }]);
        if (data.mvb_progress) setMvbProgress(data.mvb_progress);
        if (data.ready) setReady(true);
        if (Array.isArray(data.destinations) && data.destinations.length > 0) {
          updateDestinations(data.destinations);
        }
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Something went wrong — please try again." }]);
    } finally {
      setLoading(false);
    }
  }, [sessionId, loading, updateDestinations]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }, [input, sendMessage]);

  // ── Voice recording ───────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunks.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunks.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(",")[1];
          try {
            const res = await fetch(`${window.location.pathname}?_data=${encodeURIComponent("routes/apps.plekify.brief")}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "chat_transcribe", audioData: base64, mimeType: "audio/webm" }),
            });
            const data = await res.json();
            if (data.success && data.text) {
              setInput((prev) => (prev ? `${prev} ${data.text}` : data.text));
            }
          } catch {}
        };
        reader.readAsDataURL(blob);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch {}
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }, []);

  // ── Entity preview ────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`${window.location.pathname}?_data=${encodeURIComponent("routes/apps.plekify.brief")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat_generate",
          briefId: sessionId,
          locked_place_ids: [...lockedItems],
        }),
      });
      const data = await res.json();
      if (data.success) setSubmitted(true);
    } catch {}
  }, [sessionId, lockedItems]);

  // ── Toggle lock helpers ───────────────────────────────────────────────────
  const toggleItemLock = useCallback((placeId: string) => {
    setLockedItems((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
  }, []);

  const toggleDestLock = useCallback((destId: string) => {
    setLockedDestinations((prev) => {
      const next = new Set(prev);
      if (next.has(destId)) next.delete(destId);
      else next.add(destId);
      return next;
    });
  }, []);

  // ── Open card (fetch videos lazily) ──────────────────────────────────────
  const openCard = useCallback(async (card: PlaceCard) => {
    const withVids = await fetchVideosForCard(card);
    setExpandedCard(withVids);
  }, [fetchVideosForCard]);

  const pct = Math.round(mvbProgress.completeness * 100);

  // ── Chat panel (shared by sidebar + drawer) ───────────────────────────────
  const chatPanel = (
    <>
      <div className="chat-header">
        <div className="chat-header-top">
          <span className="chat-title">Journey Brief</span>
          <div className="chat-controls">
            <button
              className="ctrl-btn"
              onClick={() => {
                setDarkMode((p) => {
                  const n = !p;
                  try { localStorage.setItem("plekify_dark", String(n)); } catch {}
                  return n;
                });
              }}
              title={darkMode ? "Light mode" : "Dark mode"}
            >
              {darkMode ? "☀" : "🌙"}
            </button>
          </div>
        </div>
        <div className="mvb-bar">
          <div className="mvb-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="mvb-label">
          <span>Brief completeness</span>
          <span>{pct}%</span>
        </div>
      </div>

      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`bubble-wrap ${msg.role}`}>
            <div className={`bubble ${msg.role}`}>
              <MessageText text={msg.text} entities={msg.entities} onEntityClick={openEntityPreview} />
            </div>
          </div>
        ))}
        {loading && (
          <div className="bubble-wrap assistant">
            <div className="bubble assistant bubble-typing">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="prompt-cards-row">
        {promptCards.slice(0, 5).map((card) => (
          <button
            key={card}
            className="prompt-card"
            onClick={() => { sendMessage(card); setChatOpen(false); }}
            disabled={loading || !sessionId}
          >
            {card}
          </button>
        ))}
      </div>

      <div className="input-area">
        <div className="input-wrap">
          <textarea
            ref={textareaRef}
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your ideal trip…"
            rows={1}
            disabled={loading || !sessionId}
          />
        </div>
        <button
          className={`icon-btn${recording ? " recording" : ""}`}
          onClick={recording ? stopRecording : startRecording}
          title={recording ? "Stop" : "Voice input"}
          disabled={loading || !sessionId}
        >
          🎙
        </button>
        <button
          className={`icon-btn${input.trim() ? " send-active" : ""}`}
          onClick={() => sendMessage(input)}
          title="Send"
          disabled={loading || !sessionId || !input.trim()}
        >
          ↑
        </button>
      </div>
    </>
  );

  // ── Submitted state ───────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="jc-root" data-theme={darkMode ? "dark" : "light"}>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="submitted-wrap">
          <div className="submitted-icon">✦</div>
          <div className="submitted-title">Your journey is taking shape.</div>
          <div className="submitted-body">
            Your travel brief has been received. A consultant will be in touch shortly to bring it to life.
          </div>
        </div>
      </div>
    );
  }

  // ── Active destination cards ──────────────────────────────────────────────
  const activeCards = activeDestId ? canvasCards[activeDestId] : null;

  function renderCategory(
    title: string,
    cards: PlaceCard[],
    loading: boolean
  ) {
    return (
      <div className="category-col">
        <div className="category-title">{title}</div>
        {loading ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : cards.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", paddingTop: 4 }}>
            None found nearby
          </div>
        ) : (
          cards.map((card) => (
            <CompactCard
              key={card.id}
              card={card}
              locked={lockedItems.has(card.id)}
              onToggleLock={() => toggleItemLock(card.id)}
              onClick={() => openCard(card)}
            />
          ))
        )}
      </div>
    );
  }

  // ── Itinerary view ────────────────────────────────────────────────────────
  if (itineraryView && itinerary) {
    const day = itinerary.days[activeDay];
    const locked = shortlist.filter((s) => s.locked);
    return (
      <div className="itinerary-root" data-theme={darkMode ? "dark" : "light"}>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        
        {/* Header */}
        <div className="itin-header">
          <button className="itin-back" onClick={() => setItineraryView(false)}>
            ← Back to Chat
          </button>
          <h1 className="itin-title">{itinerary.title}</h1>
          <div className="itin-meta">
            {itinerary.totalNights} nights · {itinerary.days.length} days
          </div>
        </div>

        {/* 3-Pane Workspace */}
        <div className="itin-workspace">
          {/* Left: Day Navigator */}
          <div className="itin-pane itin-pane--nav">
            <div className="pane-header">Days</div>
            <div className="day-list">
              {itinerary.days.map((d, i) => (
                <button
                  key={d.dayNumber}
                  className={`day-item${i === activeDay ? " active" : ""}`}
                  onClick={() => setActiveDay(i)}
                >
                  <span className="day-num">{d.dayNumber}</span>
                  <span className="day-dest">{d.destination}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Center: Day Detail */}
          <div className="itin-pane itin-pane--detail">
            <div className="pane-header">Day {day.dayNumber} — {day.destination}</div>
            <div className="day-detail">
              {day.property && (
                <div className="day-property">
                  {day.property.image && (
                    <img src={day.property.image} alt={day.property.name} className="prop-hero" />
                  )}
                  <h3 className="prop-name">{day.property.name}</h3>
                  {day.property.handle && (
                    <a
                      href={`/pages/place/${day.property.handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="prop-link"
                    >
                      View property →
                    </a>
                  )}
                </div>
              )}
              <div className="day-notes">
                <h4>Notes</h4>
                <p>{day.notes}</p>
              </div>
              {day.activities.length > 0 && (
                <div className="day-section">
                  <h4>Activities</h4>
                  <ul>
                    {day.activities.map((a) => (
                      <li key={a.id}>{a.name}</li>
                    ))}
                  </ul>
                </div>
              )}
              {day.dining.length > 0 && (
                <div className="day-section">
                  <h4>Dining</h4>
                  <ul>
                    {day.dining.map((d) => (
                      <li key={d.id}>{d.name}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Right: Trip Summary */}
          <div className="itin-pane itin-pane--summary">
            <div className="pane-header">Trip Overview</div>
            <div className="trip-summary">
              <div className="summary-route">
                {locked.map((item, i) => (
                  <div key={item.id} className="route-stop">
                    <span className="route-dot" />
                    <span className="route-name">{item.name}</span>
                    <span className="route-nights">{item.nights || 2}n</span>
                    {i < locked.length - 1 && <span className="route-line" />}
                  </div>
                ))}
              </div>
              <div className="summary-total">
                <span>Total</span>
                <span>{itinerary.totalNights} nights</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  // ── Itinerary view ────────────────────────────────────────────────────────
  if (itineraryView && itinerary) {
    const day = itinerary.days[activeDay];
    const locked = shortlist.filter((s) => s.locked);
    return (
      <div className="itinerary-root" data-theme={darkMode ? "dark" : "light"}>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        
        {/* Header */}
        <div className="itin-header">
          <button className="itin-back" onClick={() => setItineraryView(false)}>
            ← Back to Chat
          </button>
          <h1 className="itin-title">{itinerary.title}</h1>
          <div className="itin-meta">
            {itinerary.totalNights} nights · {itinerary.days.length} days
          </div>
        </div>

        {/* 3-Pane Workspace */}
        <div className="itin-workspace">
          {/* Left: Day Navigator */}
          <div className="itin-pane itin-pane--nav">
            <div className="pane-header">Days</div>
            <div className="day-list">
              {itinerary.days.map((d, i) => (
                <button
                  key={d.dayNumber}
                  className={`day-item${i === activeDay ? " active" : ""}`}
                  onClick={() => setActiveDay(i)}
                >
                  <span className="day-num">{d.dayNumber}</span>
                  <span className="day-dest">{d.destination}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Center: Day Detail */}
          <div className="itin-pane itin-pane--detail">
            <div className="pane-header">Day {day.dayNumber} — {day.destination}</div>
            <div className="day-detail">
              {day.property && (
                <div className="day-property">
                  {day.property.image && (
                    <img src={day.property.image} alt={day.property.name} className="prop-hero" />
                  )}
                  <h3 className="prop-name">{day.property.name}</h3>
                  {day.property.handle && (
                    <a
                      href={`/pages/place/${day.property.handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="prop-link"
                    >
                      View property →
                    </a>
                  )}
                </div>
              )}
              <div className="day-notes">
                <h4>Notes</h4>
                <p>{day.notes}</p>
              </div>
              {day.activities.length > 0 && (
                <div className="day-section">
                  <h4>Activities</h4>
                  <ul>
                    {day.activities.map((a) => (
                      <li key={a.id}>{a.name}</li>
                    ))}
                  </ul>
                </div>
              )}
              {day.dining.length > 0 && (
                <div className="day-section">
                  <h4>Dining</h4>
                  <ul>
                    {day.dining.map((d) => (
                      <li key={d.id}>{d.name}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Right: Trip Summary */}
          <div className="itin-pane itin-pane--summary">
            <div className="pane-header">Trip Overview</div>
            <div className="trip-summary">
              <div className="summary-route">
                {locked.map((item, i) => (
                  <div key={item.id} className="route-stop">
                    <span className="route-dot" />
                    <span className="route-name">{item.name}</span>
                    <span className="route-nights">{item.nights || 2}n</span>
                    {i < locked.length - 1 && <span className="route-line" />}
                  </div>
                ))}
              </div>
              <div className="summary-total">
                <span>Total</span>
                <span>{itinerary.totalNights} nights</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  // Landing state: video background + centered input before first message
  if (!hasStarted) {
    return (
      <div className="landing-root" data-theme={darkMode ? "dark" : "light"}>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />

        {/* Video Background */}
        <div className="landing-video-bg">
          <video autoPlay muted loop playsInline>
            <source src={config?.videoUrl} type="video/mp4" />
          </video>
          <div className="landing-scrim" />
        </div>

        {/* Content */}
        <div className="landing-content">
          <div className="landing-header">
            <h1 className="landing-title">Design your journey</h1>
            <p className="landing-subtitle">describe what you&apos;re dreaming of.</p>
          </div>

          {/* Input Area */}
          <div className="landing-input-wrap">
            <textarea
              ref={textareaRef}
              className="landing-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="I want to see the Big Five in Kenya..."
              rows={1}
              disabled={loading || !sessionId}
            />
            <div className="landing-input-actions">
              <button
                className={`landing-voice-btn${recording ? " recording" : ""}`}
                onClick={recording ? stopRecording : startRecording}
                title={recording ? "Stop" : "Voice input"}
                disabled={loading || !sessionId}
              >
                🎙
              </button>
              <button
                className="landing-send-btn"
                onClick={() => sendMessage(input)}
                title="Send"
                disabled={loading || !sessionId || !input.trim()}
              >
                ↑
              </button>
            </div>
          </div>

          {/* Prompt cards */}
          <div className="landing-prompts">
            <div className="landing-prompts-label">Try an example:</div>
            {promptCards.slice(0, 5).map((card) => (
              <button
                key={card}
                className="landing-prompt-btn"
                onClick={() => sendMessage(card)}
                disabled={loading || !sessionId}
              >
                {card}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-phase" data-theme={darkMode ? "dark" : "light"}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Video background */}
      <div className="video-bg">
        <video autoPlay muted loop playsInline>
          <source src={config?.videoUrl} type="video/mp4" />
        </video>
        <div className="video-overlay" />
      </div>

      {/* Chat column */}
      <div className="chat-column">
        {/* Messages */}
        <div className="chat-scroll">
          {messages.map((msg, i) => (
            <div key={i} className={`msg-row ${msg.role}`}>
              <div className={`msg-bubble ${msg.role}`}>
                <MessageText text={msg.text} entities={msg.entities} onEntityClick={openEntityPreview} />
              </div>
            </div>
          ))}
          {loading && (
            <div className="msg-row assistant">
              <div className="msg-bubble assistant typing">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="chat-input-wrap">
          <div className="chat-input-inner">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your ideal trip…"
              rows={1}
              disabled={loading || !sessionId}
            />
            <button
              className={`voice-btn${recording ? " recording" : ""}`}
              onClick={recording ? stopRecording : startRecording}
              title={recording ? "Stop" : "Voice input"}
              disabled={loading || !sessionId}
            >
              🎙
            </button>
            <button
              className="send-btn"
              onClick={() => sendMessage(input)}
              title="Send"
              disabled={loading || !sessionId || !input.trim()}
            >
              ↑
            </button>
          </div>
        </div>
      </div>

      {/* Slide-out Preview Panel */}
      {previewEntity && (
        <div className="preview-overlay" onClick={closePreview}>
          <div className="preview-panel" onClick={(e) => e.stopPropagation()}>
            <button className="preview-close" onClick={closePreview}>×</button>
            {previewLoading ? (
              <div className="preview-loading">Loading…</div>
            ) : previewData ? (
              <div className="preview-content">
                {previewData.image && (
                  <div className="preview-hero">
                    <img src={previewData.image} alt={previewData.name} />
                  </div>
                )}
                <div className="preview-body">
                  <h2 className="preview-title">{previewData.name}</h2>
                  <div className="preview-meta">
                    {previewData.rating && <span>⭐ {previewData.rating}</span>}
                    {previewData.location && <span>📍 {previewData.location}</span>}
                    {previewData.style && <span className="preview-style">{previewData.style}</span>}
                  </div>
                  {previewData.description && (
                    <p className="preview-desc">{previewData.description}</p>
                  )}
                  <div className="preview-actions">
                    <button
                      className="preview-add-btn"
                      onClick={() => {
                        addToShortlist({
                          id: previewData.id,
                          name: previewData.name,
                          type: "property",
                          handle: previewData.shopify_handle,
                          image: previewData.image,
                          nights: 2,
                        });
                        closePreview();
                      }}
                    >
                      + Add to Trip
                    </button>
                    {shortlist.some((s) => s.id === previewData.id) && (
                      <button
                        className="preview-remove-btn"
                        onClick={() => removeFromShortlist(previewData.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {previewData.shopify_handle && (
                    <a
                      className="preview-cta"
                      href={`/pages/place/${previewData.shopify_handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View Full Page →
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="preview-empty">No details found</div>
            )}
          </div>
        </div>
      )}

      {/* Overlays */}
      {expandedCard && (
        <ExpandedCard
          card={expandedCard}
          locked={lockedItems.has(expandedCard.id)}
          onToggleLock={() => toggleItemLock(expandedCard.id)}
          onClose={() => setExpandedCard(null)}
          onOpenGallery={(idx) => {
            setGalleryCard(expandedCard);
            setExpandedCard(null);
          }}
          onOpenVideo={(url) => {
            setActiveVideoUrl(url);
            setExpandedCard(null);
          }}
        />
      )}

      {galleryCard && (
        <GalleryOverlay
          card={galleryCard}
          onClose={() => setGalleryCard(null)}
        />
      )}

      {activeVideoUrl && (
        <VideoModal
          videoUrl={activeVideoUrl}
          onClose={() => setActiveVideoUrl(null)}
        />
      )}

      {/* ── Trip Shortlist Bar ── */}
      {shortlist.length > 0 && (
        <div className="shortlist-bar">
          <div className="shortlist-inner">
            <div className="shortlist-items">
              {shortlist.map((item) => (
                <div key={item.id} className={`shortlist-chip${item.locked ? " locked" : ""}`}>
                  {item.image && <img src={item.image} alt="" className="chip-thumb" />}
                  <span className="chip-name">{item.name}</span>
                  <div className="chip-controls">
                    {editingNights === item.id ? (
                      <input
                        type="number"
                        min={1}
                        max={30}
                        defaultValue={item.nights || 2}
                        autoFocus
                        onBlur={(e) => {
                          updateNights(item.id, parseInt(e.target.value) || 2);
                          setEditingNights(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            updateNights(item.id, parseInt((e.target as HTMLInputElement).value) || 2);
                            setEditingNights(null);
                          }
                        }}
                        className="nights-input"
                      />
                    ) : (
                      <button
                        className="nights-btn"
                        onClick={() => setEditingNights(item.id)}
                        title="Click to set nights"
                      >
                        {item.nights || 2}n
                      </button>
                    )}
                    <button
                      className={`lock-btn${item.locked ? " is-locked" : ""}`}
                      onClick={() => toggleLock(item.id)}
                      title={item.locked ? "Locked — click to move to wishlist" : "Click to lock"}
                    >
                      {item.locked ? "🔒" : "○"}
                    </button>
                    <button
                      className="remove-chip"
                      onClick={() => removeFromShortlist(item.id)}
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="shortlist-summary">
              <span className="summary-count">
                {shortlist.filter((s) => s.locked).length} locked · {shortlist.filter((s) => !s.locked).length} wishlist
              </span>
              {shortlist.filter((s) => s.locked).length >= 2 && (
                <button className="compile-btn" onClick={handleGenerate}>
                  Compile Itinerary →
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
