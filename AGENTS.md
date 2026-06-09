# AGENTS.md — murmurgo-theme

> **Last Optimized:** 2026-06-09
> **Canonical Vault:** `/var/www/plekify/Plekify-Vault/index.md`

## Purpose

Shopify Liquid theme for **murmurgo.com** — the B2C content discovery and AI itinerary platform.

This theme powers:
- A browsable, searchable, AI-queryable interface of properties, activities, destinations, and content across 14 African countries
- The AI itinerary design pipeline with four rendered views per itinerary
- Customer-facing pages for content exploration and advanced access subscriptions

**Not to be confused with:** `app/plekify-b2b-theme/` (the B2B PMS demo theme on plekify.com).

## Brand Position

- **plekify.com** = B2B property reservations & PMS (property dashboard)
- **murmurgo.com** = B2C content discovery + AI itinerary design + data pipeline

## Directory Structure

```
murmurgo-theme/
├── sections/           # ~270 Liquid sections
├── blocks/             # ~105 reusable blocks
├── templates/          # ~115 JSON + Liquid templates
│   ├── product.*.json  # Property, activity, destination product templates
│   ├── collection.*.json
│   ├── page.*.json     # Including page.ai, page.browse
│   └── metaobject/     # Metaobject templates (place, city, country, etc.)
├── snippets/           # ~244 Liquid snippets
├── assets/             # JS, CSS, images, fonts
├── layout/             # Theme layouts
├── config/             # settings_data.json, settings_schema.json
└── locales/            # Translation files (11 languages)
```

## Key Templates

| Template | Purpose |
|----------|---------|
| `page.ai.json` | AI itinerary design interface |
| `page.browse.json` | Content discovery browse page |
| `product.json` | Standard product (property/activity) |
| `collection.json` | Collection grid views |
| `metaobject/murmurgo_place.json` | Place detail from metaobjects |

## Key Sections

- `wetu-breadcrumbs.liquid` — Breadcrumb navigation
- `travel-search-wetu-bridge-data.liquid` — Wetu data bridge for search
- `property-nav-bar.liquid` — Property detail navigation

## Related Repos

| Repo | Relationship |
|------|-------------|
| `murmurgo-app/` | Shopify embedded app that syncs Wetu content → this theme |
| `murmurgo-mail-dashboard/` | Next.js email dashboard for itinerary communications |
| `Itinerary-scraper-wetu/` | Produces canonical itinerary JSON consumed by murmurgo-app |

## Commands

```bash
# Theme development (requires Shopify CLI)
shopify theme dev --store murmurgo-2.myshopify.com

# Deploy
python3 deploy.py              # full deploy
python3 deploy_m5_only.py      # M5-only deploy
```

## Do Not Touch

- `templates/metaobject/*.json` — these map to Shopify metaobject definitions managed by murmurgo-app
- `assets/money-formatting.js` — shared currency formatting used by checkout

## Notes

- This theme is **separate** from `app/plekify-b2b-theme/`. The B2B theme handles client microsite demos; this theme handles consumer content discovery.
- Both themes share some design DNA but serve different customer journeys.
