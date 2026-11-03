# Demo data

Three fictional patients at the **Edoscentre** facility (code `EDO`). Every record is authored by **Val**, the administrator.

| Patient | Journey |
|---|---|
| Amina Wekesa | **Outpatient.** Check-in, triage, signed consultation, diagnosis, full blood count (validated), two prescriptions dispensed from stock, paid by M-Pesa, sent home with a follow-up date. |
| Brian Otieno | **Inpatient, still admitted** (bed DEMO-1). Arrived through Emergency, then admission requested and approved. Penicillin allergy and SHA cover on file. Ward round, nursing notes and a care plan. Observations with an early-warning escalation (resolved). Ceftriaxone on the eMAR with a dose given, plus a PRN paracetamol dose. Fluid balance, IV cannulation. Blood count with a critical value phoned through, chest X-ray reported and validated. Bed-days, charges and a deposit. |
| Grace Njeri | **Inpatient, discharged.** Admitted and treated. Final diagnosis, discharge summary, medication reconciliation, every clearance and the bill paid. Discharge authorised, and bed DEMO-2 released for cleaning. |

**What the demo adds besides the patients:**
- A General Ward (demo) with four beds.
- Demo prices, drugs and a demo pharmacy with stock.
- A blood count test and a chest X-ray examination.
- Demo early-warning bands.

All of it is marked DEMO. The bands, reference ranges and prices are **samples for showing the screens, not clinical guidance**.

To show every section, the demo also gives Val the clinical, nursing, pharmacy, lab, imaging and cashier roles. The removal script takes those roles away again.

## Load

1. Apply migrations 0001–0013, then 0099.
2. In the Supabase SQL editor, paste the whole of `01_load_demo.sql` with nothing selected, and run it.

It ends by listing the three patients. It refuses to run a second time.

## Remove

Paste and run the whole of `02_remove_demo.sql`. It deletes the three demo patients and everything recorded about them. It also deletes the demo ward, beds, prices, drugs, stock, tests and bands, and Val's demo roles.

Nothing else is touched. Real patients, real catalogue items and Val's administrator role stay.

Both scripts are tested together in `tests/db/demo.test.ts`: load, check every journey, remove, and confirm every table is back to its exact row count from before.
