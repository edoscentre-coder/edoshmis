# EDOSHMIS

**EDOS Hospital Management Information System**, by EDOS Centre Ltd.
*Smarter Hospital Operations. Better Patient Care.*

A hospital management system for Kenyan hospitals, built around a detailed inpatient (IPD) module. It covers:
- admission requests and approval;
- a live bed board that can never double-book a bed;
- the inpatient workspace: ward rounds, nursing, observations with configurable early-warning scores, the medication chart and eMAR, fluid balance and procedures;
- running inpatient bills;
- a discharge that releases the bed only when every clearance is done.

**Stack:** Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Supabase (`edos_db`, all objects prefixed `edoshmis_`).

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — what was found in `edos_db`, the decisions, modules, database plan, security model and roadmap.
- [docs/SETUP.md](docs/SETUP.md) — applying the migrations, the first platform admin, running locally.
- `npm test` — migrations and the full inpatient journey against an in-process Postgres, with RLS on.
