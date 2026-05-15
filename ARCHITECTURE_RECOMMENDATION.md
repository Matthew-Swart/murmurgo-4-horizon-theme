# Murmurgo Unified Metaobject Architecture — Recommendation

> **Date:** 2026-05-13
> **Context:** murmurgo-4.myshopify.com (Horizon Live v3)
> **Problem:** Two parallel rendering systems, 285 metaobjects vs 14,521 Tier 1 places in DB, non-tourism content leaking into browse.

---

## 1. Executive Summary

**Adopt the M3 metaobject schema as the single canonical system.** All place data lives in Shopify metaobjects. All rendering flows through metaobject templates. Shopify Pages with `plekify.*` metafields become metaobject entries. The browse page queries metaobjects natively, not an external API.

**Deleted today:** 14 unused metaobject definitions (country, region, city, property, activity, murmurgo_room, murmurgo_activity, murmurgo_restaurant, murmurgo_spa, murmurgo_bar, murmurgo_conference_venue, murmurgo_document, murmurgo_video, murmurgo_panorama).

**Remaining:** 4 definitions (murmurgo_place, murmurgo_polygon, murmurgo_media_asset, murmurgo_supplier).

---

## 2. Why Metaobjects Are the Correct Choice

| Requirement | Pages + Metafields | Metaobjects (M3 Schema) |
|---|---|---|
| **Native Shopify URLs** | Manual page creation | `/pages/place/{handle}` auto-generated |
| **Structured data / JSON-LD** | Hardcoded per template | Rendered from typed fields |
| **SEO title/description** | Page-level only | Per-entry `seo` capability |
| **Query in Liquid** | Cannot query all pages | `shop.metaobjects.murmurgo_place.values` |
| **Search & Discovery filters** | Not supported | Product metafield mirroring (M6 worker) |
| **AI agent discoverability** | Unstructured | Typed schema, consistent URLs |
| **Child entities** | Nested metafield JSON | First-class references (room→place) |
| **Bulk operations** | Page-by-page | `metaobjectBulkUpsert`, `metaobjectBulkDelete` |
| **Version control** | Manual admin edits | GraphQL API, scriptable, reproducible |

---

## 3. The Two Data Quality Problems

### Problem A: Filter Mismatch (Bad Content in Browse)

**Root cause:** `discovery_scraper.py` uses an older keyword filter that defaults to PASS for unknown types. The canonical `tourism_filter.py` (used by import, enrichment, CDN, Shopify sync) blocks them. But the browse API at `app.murmurgo.com` queries the raw database, bypassing the filter.

**Evidence:** Vape stores, cannabis cafes, cellular shops appear in `/pages/browse` because the browse API returns all `plekify_data.places` rows, not just `is_tourism_relevant() = true`.

**Fix:** Apply the canonical filter at query time in the browse API. Two options:
- **Option A (recommended):** Add a `tourism_relevant boolean` column to the `places` table, computed by `is_tourism_relevant()` at import time. The browse API adds `WHERE tourism_relevant = true`.
- **Option B:** Re-run `cleanup_non_tourism.py` to delete non-tourism rows from the database entirely.

### Problem B: Sync Gap (14,521 Tier 1 → 285 in Shopify)

**Root cause:** The Shopify sync worker (`scripts/shopify_sync_runner.py`) is PAUSED. The last sync only covered a subset of South Africa places.

**Current state:**
- Database: 14,521 Tier 1, 69,576 Tier 2, 103,181 Tier 3
- Shopify: 285 murmurgo_place (55 T1, 46 T2, 184 T3)
- Coverage: 1.96% of Tier 1

**Fix:** Resume the sync worker with the correct scope.

---

## 4. Target Architecture (Single System)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PLEKIFY DATA PIPELINE                           │
│  Google Maps → Postgres (450K places) → Tourism Filter → Tier Scoring   │
│  Website Scrape → QMD Index → AI Copy Generation                        │
│  Wetu API → Match Evidence → wetu_* namespace (linked, not merged)      │
│  YouTube Analysis → video_metadata table → murmurgo_video entries       │
│  Polygon Extraction → PostGIS → murmurgo_polygon entries                │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │  M6 Sync Worker
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         SHOPIFY METAOBJECTS                             │
│                                                                         │
│  murmurgo_place        — Every tourism place (point or area centroid)   │
│  murmurgo_polygon      — Area boundaries (countries, parks, regions)    │
│  murmurgo_media_asset  — Photos with CDN variants                       │
│  murmurgo_supplier     — Verified property owners                       │
│                                                                         │
│  (Future: murmurgo_video, murmurgo_panorama, murmurgo_document          │
│   as child entries with parent_place_ref, not separate definitions)     │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         SHOPIFY THEME (Unified)                         │
│                                                                         │
│  templates/metaobject/murmurgo_place.json      — Default place page     │
│  templates/metaobject/murmurgo_place.liquid    — Fallback (if needed)   │
│  templates/metaobject/murmurgo_polygon.json    — Country/region page    │
│  sections/                                     — Shared sections        │
│                                                                         │
│  /pages/place/{handle}  — All places (hotels, museums, parks)           │
│  /pages/place/{handle}  — All polygons (countries, regions, parks)      │
│                                                                         │
│  NO MORE:                                                               │
│  - page.place-country.liquid (plekify_region metafields)                │
│  - page.place-city.liquid (plekify_region metafields)                   │
│  - page.murmurgo-place.liquid (plekify.* metafields)                    │
│  - page.place-province.liquid                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Theme Cleanup Required

### 5.1 Delete These Templates (Data Migrated to Metaobjects)

| Template | Replaced By | Action |
|---|---|---|
| `templates/page.place-country.liquid` | `templates/metaobject/murmurgo_polygon.json` | **Delete** |
| `templates/page.place-city.liquid` | `templates/metaobject/murmurgo_polygon.json` | **Delete** |
| `templates/page.place-province.liquid` | `templates/metaobject/murmurgo_polygon.json` | **Delete** |
| `templates/page.murmurgo-place.liquid` | `templates/metaobject/murmurgo_place.json` | **Delete** |
| `templates/page.explore.liquid` | `templates/page.browse.json` + metaobject query | **Delete** |

### 5.2 Create These Templates

| Template | Purpose |
|---|---|
| `templates/metaobject/murmurgo_place.json` | Rich place detail (hotel, restaurant, museum) |
| `templates/metaobject/murmurgo_polygon.json` | Area detail (country, region, park) |

**Why JSON templates?** Per Shopify best practices (via MCP):
- JSON templates use theme sections — merchants can customize via the Online Store editor
- Sections are reusable across templates
- Better for SEO (sections can inject meta tags independently)
- Future-proof for theme app extensions

### 5.3 Create/Consolidate Sections

Instead of `country-hero`, `city-hero`, `region-hero`, `property-hero-gallery`, `stay-hero-gallery` etc., create **generic sections** parameterized by context:

| Section | Replaces | Parameters |
|---|---|---|
| `murmurgo-hero` | `country-hero`, `city-hero`, `region-hero`, `property-hero-gallery`, `activity-hero` | `background_image`, `title`, `subtitle`, `badge` |
| `murmurgo-header` | `country-header`, `city-header`, `region-header`, `property-header`, `activity-header` | `name`, `type`, `rating`, `price_band`, `tier` |
| `murmurgo-map` | `country-map`, `city-map`, `region-map`, `property-map`, `activity-map` | `lat`, `lon`, `polygon_ref`, `zoom_level` |
| `murmurgo-description` | `country-description`, `city-description`, `region-description`, `property-description`, `activity-description` | `content` (rich_text) |
| `murmurgo-gallery` | `property-hero-gallery`, `city-featured-properties` | `image_refs`, `layout` (grid/carousel) |
| `murmurgo-related` | `country-regions`, `city-featured-properties`, `region-subregions` | `filter_type`, `filter_country`, `filter_tier` |
| `murmurgo-jsonld` | Inline `<script>` tags in templates | `schema_type`, `metaobject` |

---

## 6. Metaobject Definition Changes

### 6.1 `murmurgo_place` — Enrich Schema

Add fields that currently only exist in `page.metafields.plekify.*`:

| Field | Type | Source | Priority |
|---|---|---|---|
| `copy_short` | multi_line_text | `plekify_data.places.copy_short` | High |
| `copy_medium` | multi_line_text | `plekify_data.places.copy_medium` | High |
| `copy_long` | multi_line_text | `plekify_data.places.copy_long` | High |
| `copy_tips` | multi_line_text | `plekify_data.places.copy_tips` | High |
| `seo_title` | single_line_text | `plekify_data.places.seo_title` | High |
| `seo_description` | multi_line_text | `plekify_data.places.seo_description` | High |
| `google_rating` | number_decimal | Already exists as `rating_avg` | — |
| `google_review_count` | number_integer | Already exists as `rating_count` | — |
| `formatted_address` | single_line_text | `plekify_data.places.formatted_address` | Medium |
| `phone` | single_line_text | `plekify_data.places.phone` | Medium |
| `email` | single_line_text | `plekify_data.places.email` | Medium |
| `opening_hours` | json | `plekify_data.places.opening_hours` | Medium |
| `website` | url | `plekify_data.places.website` | Medium |
| `price_level` | number_integer | Google `price_level` (1-4) | Medium |
| `city` | single_line_text | `plekify_data.places.city` | High |
| `region` | single_line_text | `plekify_data.places.region` | High |
| `jsonld_graph` | json | `plekify_data.places.jsonld_graph` | Medium |
| `search_keywords` | json | `plekify_data.places.search_keywords` | Medium |
| `wetu_pin_id` | single_line_text | Wetu match evidence | Medium |
| `wetu_property_id` | single_line_text | Wetu match evidence | Medium |
| `youtube_channel_id` | single_line_text | YouTube pipeline | Low |
| `youtube_video_count` | number_integer | YouTube pipeline | Low |
| `youtube_videos_json` | json | YouTube pipeline | Low |

**Field limit:** Currently 33/40. Adding 22 fields would exceed the 40-field limit.

**Recommendation:** Use **JSON fields** for related metadata clusters:
- `copy_json`: `{short, medium, long, tips}` (1 field)
- `seo_json`: `{title, description, keywords}` (1 field)
- `contact_json`: `{address, phone, email, website, opening_hours}` (1 field)
- `wetu_json`: `{pin_id, property_id, match_confidence, match_signals}` (1 field)
- `youtube_json`: `{channel_id, video_count, videos: [...]}` (1 field)

This adds 5 JSON fields instead of 22 individual fields, staying within the 40-field limit.

### 6.2 `murmurgo_polygon` — Activate

Currently 0 entries. This is critical for destination hub pages (countries, regions, parks).

**Data source:** PostGIS `polygon_places` table (GADM, OSM, WDPA, curated).

**Sync priority:**
1. Countries (14 African countries)
2. Provinces/states (~200)
3. Tourism regions (~100, curated)
4. National parks & reserves (~500)
5. Private conservancies (~1,000)

### 6.3 `murmurgo_media_asset` — Expand

Currently 15 entries. Target: ~1M at full backfill.

**Warning:** Shopify metaobject entry limit is 1M per definition.

**Mitigation:**
- Aggressive pHash dedup before ingest
- Only sync **hero + gallery** assets for Tier 1-2 places to Shopify
- Keep full photo pools in R2/CDN, reference by URL in `gallery_urls_json` field on `murmurgo_place`

---

## 7. SEO & Agentic Optimization Strategy

### 7.1 Metaobject SEO Fields

Enable the `renderable` capability on both definitions to expose `seo` fields:

```graphql
mutation {
  metaobjectDefinitionUpdate(
    id: "gid://shopify/MetaobjectDefinition/18004312284",
    definition: {
      capabilities: {
        renderable: { enabled: true }
      }
    }
  ) { ... }
}
```

This adds per-entry:
- `seo.title` — `<title>` tag
- `seo.description` — `<meta name="description">`

### 7.2 JSON-LD Structured Data

Use a generic `murmurgo-jsonld` section that renders the correct schema type:

| Place Type | Schema.org Type |
|---|---|
| Country | `Country` |
| Province/Region | `AdministrativeArea` |
| City | `City` |
| National Park | `Park` |
| Hotel/Lodge | `LodgingBusiness` |
| Restaurant | `Restaurant` |
| Museum | `Museum` |
| Activity | `TouristAttraction` |

Include:
- `@id` = canonical URL
- `geo` = lat/lon
- `aggregateRating` = Google rating + review count
- `address` = formatted address
- `telephone`, `email`, `url` = contact info
- `image` = hero image CDN URL
- `priceRange` = price band

### 7.3 Agentic Optimization (AI Search / LLM Discoverability)

| Technique | Implementation |
|---|---|
| **Semantic HTML** | Use `<article>`, `<header>`, `<section>`, `<address>` |
| **Linked Data** | Full JSON-LD on every page |
| **BreadcrumbList** | JSON-LD breadcrumb: Home → Country → Region → City → Place |
| **FAQPage** | If tips exist, render as FAQPage schema |
| **Consistent URLs** | `/pages/place/{handle}` for ALL places |
| **Sitemap** | Auto-generated by Shopify (metaobjects included if onlineStore enabled) |
| **Open Graph** | `og:title`, `og:description`, `og:image`, `og:type=place` |
| **Twitter Cards** | `twitter:card=summary_large_image` |

---

## 8. Phased Implementation Plan

### Phase 1: Data Quality Lock (This Week)

1. **Fix the filter mismatch**
   - Unify `discovery_scraper.py` and `tourism_filter.py` logic
   - Add `tourism_relevant boolean` to `places` table
   - Backfill: `UPDATE places SET tourism_relevant = is_tourism_relevant(place_record)`
   - Update browse API: `WHERE tourism_relevant = true`

2. **Clean non-tourism from browse**
   - Verify no vape/cannabis/cellular shops remain
   - Log any false positives for review

3. **Resume Shopify sync**
   - Start with Tier 1 only (14,521 places)
   - Use `metaobjectBulkUpsert` for batch creation
   - Set `capabilities: { publishable: { status: ACTIVE } }` on creation
   - Validate after each batch

### Phase 2: Theme Unification (Next 1-2 Weeks)

1. **Create `templates/metaobject/murmurgo_place.json`**
   - Use generic `murmurgo-*` sections
   - Include `murmurgo-jsonld` section
   - Include `murmurgo-seo-meta` section (title, description, OG tags)

2. **Create `templates/metaobject/murmurgo_polygon.json`**
   - Similar structure, different default sections
   - Show child places grid (points within polygon)
   - Show sub-region grid (child polygons)

3. **Migrate destination hub content**
   - South Africa page → `murmurgo_polygon` entry (country tier)
   - Cape Town page → `murmurgo_polygon` entry (city tier)
   - Western Cape page → `murmurgo_polygon` entry (province tier)
   - Copy `page.metafields.plekify_region.*` into polygon fields

4. **Delete old page templates**
   - `page.place-country.liquid`
   - `page.place-city.liquid`
   - `page.place-province.liquid`
   - `page.murmurgo-place.liquid`

5. **Set up redirects**
   - `/pages/south-africa` → `/pages/place/south-africa`
   - `/pages/cape-town` → `/pages/place/cape-town`
   - Use Shopify URL Redirects API or Cloudflare Worker

### Phase 3: Content Enrichment (Ongoing)

1. **Sync copy fields**
   - `copy_short`, `copy_medium`, `copy_long`, `copy_tips` from DB
   - Priority: Tier 1 with existing copy (10,121 places)

2. **Sync SEO fields**
   - `seo_title`, `seo_description`, `search_keywords`
   - Priority: Tier 1 with existing SEO (8,594 places)

3. **Sync contact fields**
   - `formatted_address`, `phone`, `email`, `website`, `opening_hours`
   - Priority: Tier 1 with existing data

4. **Sync photos**
   - `hero_image_ref` → first CDN photo
   - `gallery_refs` → up to 20 CDN photos
   - Only for Tier 1-2

### Phase 4: Polygon & Hierarchy (Weeks 3-4)

1. **Sync polygons**
   - Countries → `murmurgo_polygon` (14)
   - Provinces → `murmurgo_polygon` (~200)
   - Link places to polygons via `region_polygon_ref`, `country_polygon_ref`

2. **Build containment logic**
   - PostGIS `ST_Contains(polygon.geometry, place.point)`
   - Update `murmurgo_place.region_polygon_ref` for all entries

### Phase 5: Wetu Integration (Weeks 4-6)

1. **Run M1b matcher**
   - Match Google Place IDs to Wetu PINs
   - Store evidence in Postgres `wetu_google_match_evidence`

2. **Sync Wetu data**
   - For `match_status = 'HARD'`: copy Wetu text fields to `wetu_json`
   - Do NOT extract images (fetch from API on demand)

### Phase 6: YouTube Pipeline (Weeks 6-8)

1. **Extract YouTube URLs**
   - From website scrapes: find `youtube.com/channel/*` and `youtube.com/@*`
   - From Google Places API: `editorial_summary`, `website` → crawl for YouTube links

2. **Analyze channels**
   - YouTube Data API v3: `channels.list`, `playlistItems.list`
   - Store: `channel_id`, `video_count`, `subscriber_count`, `videos: [{id, title, description, duration, published_at, view_count}]`
   - Store in `youtube_json` field

3. **No video download**
   - Metadata only for now
   - Future: generate custom videos using this metadata

---

## 9. Immediate Next Steps (Today)

I need your decisions on:

1. **Shall I proceed with deleting the old page templates?** (`page.place-country.liquid`, `page.place-city.liquid`, `page.place-province.liquid`, `page.murmurgo-place.liquid`)

2. **Shall I create the JSON metaobject templates?** (`templates/metaobject/murmurgo_place.json`, `templates/metaobject/murmurgo_polygon.json`)

3. **Do you want me to fix the browse API filter?** (Requires server access to modify `place-queries.ts`)

4. **Shall I resume the Shopify sync?** (Start with Tier 1 only — 14,521 places)

5. **Should I add the JSON cluster fields to `murmurgo_place`?** (`copy_json`, `seo_json`, `contact_json`, `wetu_json`, `youtube_json`)

6. **What is the canonical URL structure you want?**
   - Option A: `/pages/place/{handle}` (Shopify default for metaobjects)
   - Option B: `/{type}/{handle}` via Cloudflare redirects (e.g. `/stay/alphen-boutique-hotel`, `/country/south-africa`)

---

## 10. Deleted Definitions Summary

| Definition | Type | Entries Before | Reason Deleted |
|---|---|---|---|
| Country | country | 0 | Migrated to murmurgo_place + murmurgo_polygon |
| Region | region | 0 | Migrated to murmurgo_place + murmurgo_polygon |
| City | city | 0 | Migrated to murmurgo_place + murmurgo_polygon |
| Property | property | 0 | Migrated to murmurgo_place |
| Activity | activity | 0 | Migrated to murmurgo_place |
| Murmurgo Room | murmurgo_room | 0 | Never populated; use parent_place_ref instead |
| Murmurgo Activity | murmurgo_activity | 0 | Never populated; use parent_place_ref instead |
| Murmurgo Restaurant | murmurgo_restaurant | 0 | Never populated; use parent_place_ref instead |
| Murmurgo Spa | murmurgo_spa | 0 | Never populated; use parent_place_ref instead |
| Murmurgo Bar | murmurgo_bar | 0 | Never populated; use parent_place_ref instead |
| Murmurgo Conference Venue | murmurgo_conference_venue | 0 | Never populated; use parent_place_ref instead |
| Murmurgo Document | murmurgo_document | 0 | Never populated; future: file_reference on place |
| Murmurgo Video | murmurgo_video | 0 | Never populated; future: youtube_json on place |
| Murmurgo Panorama | murmurgo_panorama | 0 | Never populated; future: panorama_json on place |
