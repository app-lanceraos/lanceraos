# Pakistan tax law used by the LanceraOS Tax module (tax year 2027)

Checked by hand on 9 November 2026. This file is the source of truth for `apps/tax/law.py`. The Tax module shows only what is HIGH or MEDIUM-HIGH below. A change to the law is a change to this file and to `law.py` together, with a new `LAST_VERIFIED` date.

Tax year 2027 = 1 July 2026 to 30 June 2027 (a tax year is named for the year it ends in). The Finance Act 2026 took effect on 1 July 2026.

Confidence: HIGH = FBR's own document, or two independent texts agree. MEDIUM-HIGH = two law-text copies agree but may predate a later amendment. MEDIUM = one good secondary source, or an inference. UNKNOWN = not verified; the module never computes it.

Limit of the check: FBR Circular No. 02 of 2026-27 (8 Sep 2026) and FBR's Withholding Tax Rates Card 2027 (updated up to 30 June 2026) were read. The consolidated Income Tax Ordinance was NOT read in full (the file is too long for the tool used; section 154A is on page 337). The wording of section 154A comes from two law-text websites, "as amended by the Finance Act 2022". Changes made by the Finance Acts 2023 to 2026 to that section could be missing.

### A. Export of services (the freelancer case)
- A1 HIGH: the bank (authorised dealer) deducts tax when it realises the foreign-exchange proceeds, section 154A, at the rates in Division IVA of Part III of the First Schedule.
- A2 HIGH: 0.25% for computer software, IT or IT-enabled services by an exporter "registered with and duly certified by" PSEB; 1.00% in any other case; export proceeds for tax years 2024 up to 2029. The rate card shows no filer / non-filer (ATL) difference for 154A.
- A3 HIGH: the 0.25% rate is extended to tax year 2029 by the Finance Act 2026 (Circular 02/2026-27, section 30).
- A4 MEDIUM-HIGH: the deduction is a final tax only if (a) the return is filed, (b) withholding statements are filed if required, (c) sales-tax returns are filed if required (PSEB-certified IT exporters are excused from (c)). No credit for foreign taxes paid.
- A5 MEDIUM-HIGH: a person may choose not to be finally taxed; the choice is made every year with the return under section 114.
- A6 UNKNOWN: what happens to the 154A tax if a person opts out. Not modelled.
- A7 MEDIUM (inference): finally taxed income gets no expense deduction; the tax is a percentage of gross proceeds.
- A8 UNKNOWN: current status of section 65F (older tax credit for IT exporters). Not modelled.
- A9 NOT VERIFIED: "SRO 586(I)/2022 is a complete IT export exemption". No source found. Never cite it.
- A10 HIGH, out of scope: export of goods (section 154) is 1.25% as a minimum tax.

### B. Normal rates, non-salaried individuals and AOPs (identical for tax years 2026 and 2027)

Up to Rs 600,000 nil; 600,001 to 1,200,000: 15% of the amount over 600,000; 1,200,001 to 1,600,000: 90,000 + 20% of the amount over 1,200,000; 1,600,001 to 3,200,000: 170,000 + 30% of the amount over 1,600,000; 3,200,001 to 5,600,000: 650,000 + 40% of the amount over 3,200,000; over 5,600,000: 1,610,000 + 45% of the amount over 5,600,000. Sources: two secondary websites agree row by row and match a tax-year-2026 rate card (MEDIUM-HIGH; no FBR PDF seen for this table).

Surcharge: tax year 2027, 10% of the tax where taxable income exceeds Rs 10,000,000, for non-salaried individuals and AOPs (Circular 02/2026-27, section 8: HIGH). Tax year 2026: one rate card says 9%, FBR's circular implies 10% for non-salaried: UNKNOWN, not calculated.

Salaried slabs (not the freelancer case): see Circular 02/2026-27, section 7. Not used.

### C. Returns and payments
- C1 MEDIUM: the return is due by 30 September after the tax year ends; FBR extended the tax year 2026 return date more than once in 2026.
- C2 LOW: advance-tax instalments (section 147) for individuals; whether they apply to finally taxed income is not established. Not modelled.

### Sources
- FBR Circular No. 02 of 2026-27: https://download1.fbr.gov.pk/Docs/202698139527880CircularNo.2of2026-27.pdf
- FBR Withholding Tax Rates Card 2027: https://download1.fbr.gov.pk/Docs/202681113864992WithholdingTaxRatesCard2027.pdf
- FBR Income Tax Ordinance up to 30.06.2026 (not read in full): https://download1.fbr.gov.pk/Docs/2026724177725705IncomeTaxOrdinanace2001.pdf
- Section 154A text: https://pakarbiter.com/laws-in-pakistan/income-tax-ordinance-2001/ito-section-154a/export-of-services and https://www.thebscon.com/export-of-services-including-it-services-section-154a/
- Slabs: https://pkrevenue.com/fbr-notifies-tax-rates-for-business-individuals-aops-for-tax-year-2027/ and https://taxwizard.pk/tax-slabs/

The Tax page (`/tax`, Prompt 21) shows these facts verbatim from `GET /api/tax/law/`. The confidence legend in `frontend/src/pages/taxHelpers.js` (`CONFIDENCE_LEGEND`) restates the Confidence line above and is part of the pre-launch review. No law line above was changed.
