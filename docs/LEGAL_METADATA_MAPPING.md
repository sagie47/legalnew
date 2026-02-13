# Legal Metadata Mapping

Last updated: 2026-02-13

This file defines canonical metadata values for legal RAG ingestion and validation.

## Canonical Fields

Required:
- `authority_level`
- `doc_family`
- `instrument`
- `jurisdiction`
- `effective_date` (required for MI/Public Policy when known)

Optional:
- `expiry_date`
- `section_id`
- `program_stream`
- `noc_code`
- `teer`
- `table_type`

Naming rule:
- Use `effective_date` and optional `expiry_date`.
- Do not use `version_date`.

## Canonical Enums

### `authority_level`
- `statute`
- `regulation`
- `ministerial_instruction`
- `public_policy`
- `policy`
- `manual`
- `voi`
- `provincial_program`
- `reference`
- `jurisprudence`
- `case_law`

### `doc_family`
- `IRPA`
- `IRPR`
- `MI`
- `PUBLIC_POLICY`
- `PDI`
- `ENF`
- `VOI`
- `OINP`
- `BC_PNP`
- `AAIP`
- `NOC2021`
- `LICO_MNI`
- `IRB_GUIDE`
- `CASE_LAW`

### `instrument`
- `TRV`
- `ETA`
- `STUDY`
- `WORK`
- `PR_ECON`
- `PR_FAMILY`
- `PR_REFUGEE`
- `INADMISSIBILITY`
- `MISREP`
- `ENFORCEMENT`

### `jurisdiction`
- `federal`
- `ontario`
- `bc`
- `alberta`

## Source Mapping

| Source | authority_level | doc_family | jurisdiction |
|---|---|---|---|
| IRPA | statute | IRPA | federal |
| IRPR | regulation | IRPR | federal |
| Ministerial Instructions | ministerial_instruction | MI | federal |
| Public Policies | public_policy | PUBLIC_POLICY | federal |
| PDIs | policy | PDI | federal |
| ENF manuals | manual | ENF | federal |
| Visa Office Instructions | voi | VOI | federal |
| OINP | provincial_program | OINP | ontario |
| BC PNP | provincial_program | BC_PNP | bc |
| AAIP | provincial_program | AAIP | alberta |
| NOC 2021 | reference | NOC2021 | federal |
| LICO/MNI tables | reference | LICO_MNI | federal |
| IRB jurisprudential guides | jurisprudence | IRB_GUIDE | federal |
| Key case law | case_law | CASE_LAW | federal |

## Date Rules

- `effective_date`:
  - MI/Public Policy: use effective/in-force date from source.
  - PDI/ENF/VOI/manual content: use published/last updated date when available.
  - Acts/Regulations: use in-force/current-to date when available.
- `expiry_date`:
  - Use for temporary public policies or time-bounded instruments when available.

Date format:
- Always `YYYY-MM-DD`.

## Section ID Normalization

Examples:
- `R179(b)` -> `IRPR_179b`
- `R205` -> `IRPR_205`
- `A40(1)(a)` -> `IRPA_A40_1a`
- `A25(1)` -> `IRPA_A25_1`

## Program/Reference Fields

- `program_stream` examples:
  - `EXPRESS_ENTRY`
  - `PNP`
  - `AIP`
  - `CAREGIVER`
  - `AGRI_FOOD`
  - `RURAL`
  - `OWP`
  - `PGWP`
  - `SPOUSAL`

- `noc_code`:
  - NOC 2021 code string (4 or 5 digits as published)

- `teer`:
  - String digit `0`-`5`

- `table_type`:
  - `LICO` or `MNI` (for current scope)
