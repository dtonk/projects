# Lower Technology LLC — Website & Product Architecture

**Prepared:** April 2026

---

## Company Overview

Lower Technology LLC is a professional services company focused on data infrastructure consulting. The business also has a proprietary SaaS product in development: **Low Tech Maps**, a tool that converts PDF maps into accurately geocoded, interactive web maps.

The two offerings are intentionally linked — the map product serves as a technical showcase and lead generation engine for the consulting business.

---

## Domains

| Domain | Purpose |
|---|---|
| `lower.technology` | Primary — company/consulting site |
| `lowtechmaps.com` | Low Tech Maps SaaS platform |
| `lowtechnology.net` | Backup — acquired, not actively used |

---

## Site Architecture

The two properties are separate codebases with a shared brand identity. Hosted and deployed independently.

| URL | Purpose | Type |
|---|---|---|
| `lower.technology` | Company/consulting marketing site | Static |
| `lower.technology/products` | Products page linking out to Low Tech Maps | Static |
| `lowtechmaps.com` | Low Tech Maps platform (map gallery) | Dynamic web app |
| `lowtechmaps.com/sf-zoo` | Individual map (example) | Dynamic route |
| `lowtechmaps.com/oakland-zoo` | Individual map (example) | Dynamic route |

Maps are path-based to keep infrastructure simple and scalable to hundreds of maps. A premium custom domain option (e.g. `map.oaklandzoo.org` pointing to the platform) can be offered as a paid upsell later.

---

## Property 1: lower.technology (Company Site)

### Purpose
Marketing and credibility site for the consulting business. Fast, professional, low-maintenance.

### Pages
- **Home** — headline, value prop, CTA
- **Services** — data infrastructure specifics (pipelines, warehouses, etc.)
- **Products** — showcases Low Tech Maps as a built product; links to `lowtechmaps.com`
- **About** — company/founder background
- **Contact** — form or direct email

### Technical Notes
- Fully static site (HTML/CSS/JS)
- Host on Netlify — free tier, auto-deploy from GitHub
- No backend required

---

## Property 2: lowtechmaps.com (Low Tech Maps)

### Purpose
A standalone SaaS platform that converts PDF maps into interactive, accurately geocoded web maps. Publicly accessible maps serve as lead generation for the consulting business, while also being a viable SaaS product in their own right.

### Core Product Concept
- **Input:** A PDF map (e.g. a zoo map, campus map, venue map)
- **Output:** An interactive web map that looks like the original PDF but is geocoded and navigable
- Each map gets a clean URL: `lowtechmaps.com/[map-name]`
- The map directory at `lowtechmaps.com` acts as a public gallery

### Technical Notes
- Dynamic web app — requires a backend and database
- Database stores map metadata, assets, and eventually user/client info
- Each map route (`/sf-zoo`, `/oakland-zoo`, etc.) is dynamically served
- The map directory should be browsable/searchable — important for SEO
- Authentication and client management needed eventually (not MVP)
- Hosting: Railway or Render (persistent backend needed for Python/FastAPI)

---

## How the Two Properties Relate

- `lower.technology/products` links to `lowtechmaps.com`
- `lowtechmaps.com` footer/header links back to `lower.technology`

**Intended funnel:** a user discovers a public map → is impressed by the technical quality → visits `lower.technology` → becomes a consulting lead. The map product is both a revenue stream and the company's best case study.

---

## Recommended Build Order

| Phase | Property | Notes |
|---|---|---|
| 1 | `lower.technology` | Static, low complexity, establishes brand presence |
| 2 | `lowtechmaps.com` | Dynamic, needs backend and map rendering |
