# Medicana Stock App — Comprehensive Feature & Capability Report

> **Purpose:** This report documents every feature, capability, and value proposition of the Medicana Stock App — a pharmaceutical inventory management platform for hospitals, clinics, and healthcare facilities. Use this report to research competitive SaaS pricing structures and determine appropriate subscription tiers for potential clients.

---

## 1. Executive Summary

Medicana Stock App is a **cloud-based pharmaceutical inventory management system** designed for hospitals and healthcare facilities. It manages medication stock across multiple physical locations (pharmacies, wards, theatres, cupboards, clinics), with real-time tracking, intelligent restocking recommendations, barcode scanning, FEFO compliance, and a full audit trail.

**Key differentiators:**
- AI-powered 5-stage stock optimization pipeline with maturity-gated intelligence
- Multi-method barcode scanning (hardware IR, mobile camera, GS1 DataMatrix parsing)
- Hospital-wide redistribution engine that minimizes waste and prevents stockouts
- Comprehensive audit trail meeting pharmaceutical compliance requirements
- Role-based access control with 5 user tiers
- Zero-install web app (works on any device with a browser)

**Target market:** Private hospitals, day-surgery centres, specialty clinics, veterinary hospitals, compounding pharmacies — any facility managing medication stock across multiple storage locations.

---

## 2. Core Feature Categories

### 2.1 Inventory Management

| Feature | Description |
|---------|-------------|
| **Multi-location stock tracking** | Track medication stock across up to 14+ named locations (pharmacy, wards, theatres, cupboards, clinics, radiology, etc.) |
| **Batch-level tracking** | Every unit tracked by batch code, expiry date, brand, and serial number |
| **FEFO enforcement** | First Expiry, First Out — system enforces earliest-expiring batch usage with password-protected override and reason logging |
| **Flexible quantity entry** | Stock counted in boxes × items-per-box, individual items, or mixed (e.g., "3 boxes + 5 loose items") |
| **Real-time stock levels** | 20-second polling keeps all connected clients synchronized |
| **All-locations aggregate view** | See total stock across the entire organization with per-location breakdowns |
| **Per-location minimum levels** | Set different minimum stock thresholds for each location, or use global defaults |
| **Stock-in workflows** | Receive deliveries, record transfers in, create new batches on receipt |
| **Stock-out workflows** | Dispense to patients, transfer out, record disposals with reason codes |
| **Patient use tracking** | Record medication dispensed with patient name, local ID, clinical reason (post-op, anaesthesia, TTOs, etc.) |
| **Batch removal** | Password-protected removal for expired, damaged, or recalled stock with mandatory reason |
| **Auto-fulfillment** | Pending orders auto-fulfill when matching deliveries arrive |
| **Partial fulfillment tracking** | Track quantity received vs. quantity ordered for incomplete deliveries |

### 2.2 Barcode Scanning & GS1 Support

| Feature | Description |
|---------|-------------|
| **Hardware scanner support** | Works with any keyboard-emulation barcode scanner (infrared, laser, etc.) — detected globally, works from any screen |
| **Mobile camera scanning** | Built-in camera scanner with torch toggle, HD optimization (1920×1080), macro focus, and exposure compensation |
| **GS1 DataMatrix parsing** | Extracts structured data from 2D pharmaceutical barcodes: GTIN (01), expiry (17), batch/lot (10), serial (21), production date (11) |
| **Supported barcode formats** | EAN-13, Code 128, Code 39, UPC-A, UPC-E, EAN-8, QR Code, Data Matrix |
| **Smart barcode routing** | Scanned barcode auto-routes: known medication → stock adjustment modal; unknown → add new medication flow |
| **Enhanced decoding** | Contrast-stretching algorithm for low-contrast/smudged barcodes; parallel sidecar decoder |
| **Auto-field population** | Scanned GS1 data auto-fills medication name, batch code, expiry, brand, serial number — fields lock to prevent errors |
| **Duplicate prevention** | Blocks re-scanning of same barcode within 2 seconds |

### 2.3 Intelligent Stock Management (AI Engine)

This is the platform's key differentiator — a **5-stage hospital-wide optimization pipeline** that learns from usage patterns and progressively improves recommendations.

#### Maturity-Gated Intelligence
The system progressively unlocks capabilities as it collects data:

| Stage | Timeline | Capabilities |
|-------|----------|-------------|
| **Not Configured** | Day 0 | Basic inventory only — prompts admin to set go-live date |
| **Collecting** | Week 0–1 | Simple low-stock alerts based on fixed min levels |
| **Learning** | Weeks 1–3 | Emerging usage patterns, initial trend detection |
| **Confident** | Weeks 4–8 | Solid recommendations, min level suggestions, redistribution |
| **Mature** | 8+ weeks | Full predictive pipeline, demand forecasting, stockout projections |

#### 5-Stage Optimization Pipeline

1. **Min Level Mapping** — Analyzes recency-weighted usage (exponential decay factor 0.85) to recommend optimal minimum stock levels per medication per location
2. **FEFO Redistribution** — Identifies surplus/deficit locations and recommends peer-to-peer transfers, prioritizing earliest-expiring stock first
3. **Pharmacy Supply** — Central pharmacy supplies remaining deficits to satellite locations while maintaining a 1-box buffer
4. **Pharmacy Derived Minimum** — Calculates pharmacy's own min level as 1.5× the sum of all hospital-wide minimums (surge capacity protection)
5. **External Orders** — Generates purchase order recommendations for pharmacy, subtracting already-pending orders to prevent double-ordering

#### Intelligence Analytics

| Feature | Description |
|---------|-------------|
| **Linear regression trend analysis** | Classifies each medication's usage as increasing, stable, or decreasing |
| **Recency-weighted averaging** | Recent weeks weighted more heavily (4 weeks ago = 52% weight, 8 weeks ago = 27%) |
| **Confidence scoring** | Recommendation confidence based on weeks of actual usage data (0–100%) |
| **Stockout projection** | Predicts exact week of stockout if current usage continues |
| **Urgency classification** | Auto-classifies orders as urgent (stock = 0 or ≤ 50% of min) vs. routine |
| **Supply destination projections** | External orders include which satellite locations will consume the stock |
| **7-day pipeline caching** | Results cached for 7 days with snapshot reconciliation against current state |
| **Force regeneration** | Admins can regenerate pipeline early when needed |

### 2.4 Order Management

| Feature | Description |
|---------|-------------|
| **Manual order placement** | Place orders from any medication view with quantity, urgency, notes, pharmacist email |
| **AI-generated draft orders** | Intelligence engine auto-generates purchase order proposals based on analysis |
| **4-step review & order wizard** | Step 1: Min level adjustments → Step 2: Redistribute stock → Step 3: Pharmacy supply → Step 4: External orders |
| **Draft order review** | Review, adjust quantities, approve, or reject individual or bulk draft orders |
| **Bulk approval** | Approve all pending drafts with one action |
| **Consolidated email generation** | Multiple medications combined into single professional order email, grouped by urgency |
| **Email integration** | Copy order to clipboard or open directly in Outlook/email client with pre-filled To/Subject/Body |
| **Order status tracking** | Pending → partially fulfilled → fulfilled lifecycle |
| **Duplicate prevention** | System skips draft generation for medications with existing pending orders or drafts |

### 2.5 Intelligence Report

| Feature | Description |
|---------|-------------|
| **Full recommendation report** | Complete analysis of all medications with actions (maintain, order, increase min, decrease min) |
| **Category filtering** | View all recommendations, critical alerts only, or optimization suggestions |
| **Click-to-apply** | Apply individual min level recommendations directly from the report |
| **Location-specific reports** | Generate reports for a single location or organization-wide |
| **Maturity dashboard** | Shows system maturity level, go-live date, weeks of data collected |

### 2.6 Activity Log & Audit Trail

| Feature | Description |
|---------|-------------|
| **Complete audit trail** | Every action recorded: who, what, when, where, with full context |
| **17 activity types tracked** | Logins, logouts, stock in/out, transfers, orders placed/fulfilled, medications added/deleted/restored, batch removals, min level changes, draft orders generated/approved/rejected, bulk orders, config changes |
| **JSONB detail storage** | Rich structured data for each event (quantities, batch codes, reasons, before/after values) |
| **User attribution** | Every action linked to the user who performed it |
| **Filterable by type and user** | Drill down to specific activity categories or specific staff members |
| **Date-grouped display** | Activities organized by day with collapsible sections |
| **Infinite scroll pagination** | Load 50 entries at a time with "load more" |
| **FEFO override logging** | Records when and why staff bypassed expiry-order rules |

### 2.7 User Management & Access Control

**5 role tiers with granular permissions:**

| Role | Capabilities |
|------|-------------|
| **Administrator** | Full system access, intelligence reports, user management, demo data seeding, all configuration |
| **Pharmacist** | Full operational access, order management, draft order review & approval, intelligence pipeline |
| **Stock Manager** | Medication management, stock operations, low stock alerts, reporting (no activity log) |
| **Stock User** | Medication viewing, order placement, low stock viewing, add new medications |
| **Basic User** | Transfer stock between locations only |

| Feature | Description |
|---------|-------------|
| **Password-protected sensitive ops** | Deletion, batch removal, FEFO override, min level changes, wizard step skipping all require password re-entry |
| **Session timeout protection** | 2.5-minute inactivity warning → 30-second countdown → auto-logout |
| **Session persistence** | Sessions survive page refresh via sessionStorage + localStorage |
| **User-location assignment** | Each user can have a primary location for default views |

### 2.8 Location Management

| Feature | Description |
|---------|-------------|
| **Named locations** | Pharmacy, Wards 1–3, Theatres 1–3, Cupboards 1–3, PACU, Sapphire Clinic, Radiology |
| **Location groups** | Logical grouping (all cupboards, all theatres, all wards) for aggregate views |
| **Per-location min levels** | Override global minimums at any location |
| **Location-specific usage reasons** | Different dispensing reasons per location type (e.g., theatres: anaesthesia, post-op; wards: PRN, TTOs) |
| **Pharmacy as central hub** | Intelligence engine treats pharmacy as the supply hub for all satellite locations |

### 2.9 Reporting & Export

| Feature | Description |
|---------|-------------|
| **Low stock report export** | CSV-style export of all medications below minimum level |
| **Intelligence report** | Full AI analysis with recommendations, trends, projections |
| **Activity log filtering** | Built-in reporting via activity type and user filters |
| **Email-ready report generation** | Copy formatted reports for emailing to stakeholders |
| **Order consolidation reports** | Combined multi-medication order emails with stock context |

### 2.10 Mobile & Device Support

| Feature | Description |
|---------|-------------|
| **Responsive design** | Full mobile optimization with adaptive layouts |
| **Touch-friendly UI** | Large buttons and touch targets for warehouse/ward use |
| **Mobile camera scanning** | Full barcode scanning from smartphone camera |
| **Hardware scanner compatible** | Works with Bluetooth and USB barcode scanners on any device |
| **No app install required** | Pure web app — works in any modern browser |
| **HTTPS camera access** | Secure camera permissions handling |

### 2.11 Data & Security

| Feature | Description |
|---------|-------------|
| **Bcrypt password hashing** | Industry-standard secure password storage |
| **SQL parameterized queries** | Protection against SQL injection |
| **Server-side ID derivation** | Medication IDs derived from batch IDs server-side (untrusted client data not used) |
| **Atomic transactions** | All stock operations wrapped in database transactions with rollback |
| **SSL database connections** | Encrypted database communication |
| **Non-destructive deletion** | Soft-delete for medications (can be restored) |

---

## 3. Technical Architecture Summary

| Component | Technology |
|-----------|-----------|
| **Frontend** | React (CDN-loaded), Babel, TailwindCSS — single-page app, no build step |
| **Backend** | Netlify Functions (serverless Node.js) — 27+ API endpoints |
| **Database** | Neon PostgreSQL with SSL |
| **Authentication** | Bcrypt-based username/password |
| **Barcode Scanning** | html5-qrcode library + custom GS1 DataMatrix parser |
| **Hosting** | Netlify (serverless, auto-scaling) |
| **Bundling** | esbuild (fast, modern bundler) |

**Infrastructure cost profile:** Serverless = pay-per-use, auto-scales with client load. No dedicated servers to maintain.

---

## 4. Value Metrics for Pricing Model

These are the key dimensions that drive value and could inform tier boundaries:

| Metric | Description |
|--------|-------------|
| **Number of locations** | More storage locations = more redistribution value from AI pipeline |
| **Number of medications tracked** | Volume of SKUs under management |
| **Number of users** | Staff accounts with role-based access |
| **Intelligence pipeline access** | AI recommendations are the premium differentiator |
| **Barcode scanning** | Hardware + camera scanning capabilities |
| **Audit trail depth** | Compliance-grade logging for regulated environments |
| **Draft order automation** | AI-generated purchase orders save pharmacist time |
| **Order email integration** | Consolidated ordering workflow |
| **Number of transactions/month** | Usage volume metric |
| **Data retention period** | How far back activity logs and intelligence data go |

---

## 5. Competitive Positioning Notes

**What makes this different from generic inventory systems:**

1. **Purpose-built for pharmaceutical/healthcare** — FEFO enforcement, GS1 DataMatrix parsing, patient-use tracking, clinical reason codes, batch/lot/serial tracking
2. **AI-powered redistribution** — Not just "you're low on X, order more." The system redistributes existing stock between locations before recommending external purchases, minimizing waste and cost
3. **Maturity-gated intelligence** — The system doesn't make predictions it can't back up. Recommendations unlock progressively as data quality improves
4. **Pharmacy-centric supply chain model** — Understands the hub-and-spoke model where a central pharmacy supplies satellite locations (wards, theatres, clinics)
5. **Multi-method barcode scanning** — Hardware scanners, mobile camera, and manual entry all supported — works in any environment from warehouse to bedside
6. **Zero-install deployment** — No app to install, no software to maintain on client devices. Works on any device with a browser
7. **Complete audit trail** — Meets pharmaceutical compliance needs with full traceability of every stock movement, who did it, when, and why
8. **Serverless architecture** — Low infrastructure costs, auto-scaling, high availability without dedicated server management

---

## 6. Suggested Pricing Research Prompts for Claude Chat

When feeding this report to Claude Chat, consider asking:

1. "Based on these features, what are comparable pharmaceutical inventory management SaaS products and their pricing?"
2. "What pricing model (per-user, per-location, per-transaction, flat tier) makes most sense for a hospital pharmacy inventory system with AI features?"
3. "What would be appropriate pricing tiers (e.g., Starter, Professional, Enterprise) given these feature categories?"
4. "What is the typical willingness-to-pay for AI-powered stock optimization in healthcare settings?"
5. "How should barcode scanning, audit trail, and intelligence features be distributed across pricing tiers?"
6. "What are the key value drivers that justify premium pricing in pharmaceutical inventory management?"
7. "Based on the serverless architecture, what are typical infrastructure costs per client, and what margins should be targeted?"

---

*Report generated from full codebase analysis — Medicana Stock App, March 2026*
