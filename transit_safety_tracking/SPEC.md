# Technical Specification: Transit Safety Management System (TSMS)

## 1. Overview

A multi-tenant SaaS web application for transit agency safety & security departments to create, track, and close safety items. Each item is tied to a geocoded internal location. Multiple officers work concurrently with shared visibility, filtered by location or item type.

---

## 2. Users & Roles

| Role | Capabilities |
|---|---|
| **Safety Officer** | Create, edit, update status on any item; filter/view all items |
| **Admin** | All officer capabilities + manage users, manage location registry |
| **Viewer** *(future)* | Read-only access |

Each agency is a separate tenant. Users belong to one agency.

**Auth:** Email/password to start, SSO (SAML/OIDC) as a future requirement for enterprise agencies.

---

## 3. Core Data Model

**`agencies`** — one row per transit agency (tenant isolation)
```
id, name, slug, created_at
```

**`locations`** — agency's internal location registry
```
id, agency_id, identifier (e.g. "GLEN-PLATFORM-A"), name, type (station|segment|yard|facility|other), lat, lng, created_at
```

**`safety_items`**
```
id, agency_id, title, description, type (regulatory|corrective_action|inspection|incident|other),
status (open|in_progress|under_review|closed),
priority (low|medium|high|critical),
location_id → locations,
assigned_to → users,
created_by → users,
due_date, created_at, updated_at, closed_at
```

**`status_history`** — full audit trail
```
id, safety_item_id, old_status, new_status, changed_by → users, changed_at, notes
```

**`users`**
```
id, agency_id, email, name, role, created_at
```

---

## 4. MVP Feature Scope

### 4.1 Safety Item Lifecycle
- Create item (form with all fields; location picker from pre-loaded location registry)
- Edit item (any field except `agency_id`, `created_by`)
- Transition status → every transition appended to `status_history` with optional notes
- Close item → `closed_at` timestamp recorded, item moves to "historical" view
- Reopen closed item (admin only)

### 4.2 Item List View
- Table/card view of all active items for the agency
- **Filters:** status, type, priority, location, assigned officer, date range
- **Search:** full-text on title/description
- Column sorting
- Pagination (cursor-based, for scale)

### 4.3 Historical View
- Separate view for closed items
- Same filter/search capabilities
- Full status history visible on item detail

### 4.4 Location Registry
- Admin UI to add/edit locations (identifier, name, type, lat/lng)
- Later: bulk import from spreadsheet

### 4.5 Data Import (MVP)
- CSV import for existing safety items (mapped to schema columns)
- Import validation with per-row error reporting before commit
- Excel (.xlsx) import in Phase 2

---

## 5. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Frontend** | React + TypeScript | Ecosystem, component libraries |
| **UI library** | shadcn/ui + Tailwind | Fast, unstyled primitives, easy to theme |
| **Map** | Mapbox GL JS | Best-in-class for transit/geo; location picker widget |
| **Backend** | Node.js + Fastify | Fast, typed with Zod |
| **Database** | PostgreSQL + PostGIS | Geo queries on locations; strong relational model |
| **Auth** | Clerk | Handles multi-tenant, SSO-ready, fast to ship |
| **Hosting** | Railway or Render | Simple PaaS for prototype; migrate to AWS later |
| **ORM** | Drizzle ORM | TypeScript-native, close to SQL, pairs well with Postgres |

---

## 6. Architecture

```
Browser (React SPA)
      │
      │ HTTPS / REST
      ▼
Fastify API Server  ──── Clerk (auth middleware)
      │
      ▼
PostgreSQL + PostGIS
```

- **Tenant isolation:** `agency_id` on every table; all queries scoped by agency via middleware — never crosses tenants
- **Concurrency:** Postgres row-level locking; optimistic UI updates with server confirmation
- **Audit trail:** `status_history` is append-only; never deleted

---

## 7. Key API Endpoints (REST)

```
POST   /items              — create item
GET    /items              — list (with filters as query params)
GET    /items/:id          — item detail + status history
PATCH  /items/:id          — update fields
PATCH  /items/:id/status   — transition status (appends history row)
GET    /items/closed       — historical view
POST   /items/import       — CSV import (validate + commit)

GET    /locations          — list agency locations
POST   /locations          — create location
PATCH  /locations/:id      — edit location

GET    /users              — list agency users (admin)
POST   /users/invite       — invite new officer
```

---

## 8. Open Questions / Assumptions to Validate

1. **Location picker UX:** Should officers pick a location from a dropdown (searchable list), or click on a map? Or both?
2. **Assignment:** Can an item be assigned to multiple officers, or exactly one?
3. **Notifications:** Should officers get email/in-app alerts when an item is assigned to them or changes status?
4. **Due dates:** Are they required or optional? Should overdue items be surfaced prominently?
5. **Item types:** Are the types listed (regulatory, corrective action, inspection, incident) roughly right, or should these be configurable per agency?
6. **Location coordinates:** Do agencies already have lat/lng for their locations, or do they need to geocode from address/identifier? This affects the import flow.

---

## 9. Phase 2 (Post-MVP)

- Excel (.xlsx) import
- Map view of all active items plotted on agency's transit map
- Email/in-app notifications
- Role-based visibility (officer sees only their assigned items by default)
- Recurring item scheduling (e.g. monthly inspections auto-generate)
- Audit export (PDF/CSV) for regulatory reporting
