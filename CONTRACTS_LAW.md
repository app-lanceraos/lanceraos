# Pakistan electronic signatures used by the LanceraOS Contracts module

Last verified: 10 November 2026. Confidence: MEDIUM. One text was read (the copy on the State Bank of Pakistan website), through a summarising tool, not from the gazette. Amendments after 2002 were not checked. This is not legal advice and no lawyer has read it.

Source: Electronic Transactions Ordinance, 2002 - https://www.sbp.org.pk/about/act/ETC202.pdf

## What that text says (section numbers from that copy)
- s.2(1)(n) "electronic signature": any letters, numbers, symbols, images, characters or any combination of them in electronic form, applied to, incorporated in or associated with an electronic document.
- s.2(1)(e) "advanced electronic signature": an electronic signature that is unique to the person signing it and capable of identifying that person, created in a way under the sole control of the person using it, with changes to the document detectable; or one provided by an accredited certification service provider.
- s.3: an electronic document cannot be denied legal recognition, admissibility, effect, validity, proof or enforceability only because it is in electronic form and has not been attested by a witness.
- s.4: a requirement that something be in writing is met when it is in electronic form and can be accessed later.
- s.7: a legal requirement for signatures is met where "electronic signatures or advanced electronic signature" are applied. The wording is not clear about whether an ordinary electronic signature is enough on its own. Ask a lawyer.
- s.8: an electronic signature may be proved in any manner.
- s.13: when an electronic communication is treated as the originator's.
- s.31(1): the Ordinance does not apply to negotiable instruments; powers of attorney; trusts (except constructive, implied and resulting trusts); wills and other testamentary dispositions; contracts for the sale or conveyance of immovable property or any interest in it.
- Article 78-A of the Qanun-e-Shahadat Order 1984 (inserted by the Ordinance): if a signature is denied, the use of a security procedure has to be proved.

## What LanceraOS does with it
- A typed name is an "electronic signature" under s.2(1)(n). It is NOT an "advanced electronic signature".
- Because s.8 allows proof "in any manner", LanceraOS records, for each signer, the typed name, the time, the IP address and the browser details, and keeps a SHA-256 fingerprint of the text that was signed.
- LanceraOS never says that a contract is "legally binding", "valid", "enforceable" or "certified", and never says that a signer's identity was verified.
- The templates are for service agreements. They are not for the s.31(1) categories.
- Clients in other countries: their law (for example ESIGN and UETA in the United States, eIDAS in the European Union) has NOT been assessed.

## Unknown, not checked
Amendments after 2002; whether courts accept a typed name in practice; stamp duty on service agreements; provincial rules; the law of foreign clients; whether Article 78-A needs more than the evidence kept here.

## Before public launch
A Pakistani lawyer reads this file, the clause library (`apps/contracts/clauses.py`), the signing-page wording (Prompt 23), the contract emails and the PDF text. Until then the Contracts pages must not be announced publicly.
