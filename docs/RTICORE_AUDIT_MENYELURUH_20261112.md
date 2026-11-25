# Audit fitur, fungsi, menu, proses dan formulasi RTICore

12 November 2026. Baseline Git `4670b2d` beserta perbaikan lokal yang sudah ada sebelum audit. Pemeriksaan mencakup navigasi, handler API, guard transaksi, rumus domain dan suite regresi. Status menu berarti menu tercantum untuk role, sedangkan otorisasi akhir bergantung pada akun aktif, kebijakan akses, kepemilikan, alokasi atau grant sesuai modul.

## Temuan

| Prioritas | Temuan dan dampak | Bukti | Perbaikan yang disarankan |
|---|---|---|---|
| P1 | Marketing tidak mendapat menu BoQ tetapi handler daftar BoQ tidak menolaknya. Setelah identitas dan kebijakan akses lolos, hanya Sales mendapat filter owner. Marketing dapat menerima daftar komersial lintas Opportunity pada kebijakan default. HPP tetap disembunyikan oleh serializer. | `src/lib/boq-auth.ts` 58–78, `src/app/api/boq/route.ts` 17–30, `src/lib/enterprise-navigation.ts` 60 | Gunakan allowlist baca yang konsisten di daftar, detail dan ekspor. Uji Marketing dan Viewer per operasi. |
| P1 | Feasibility Offense dan IT Developer menerima proyek Won yang cocok keluarga layanannya tanpa mengikat akun ke alokasi aktif. Pemilih hanya menyertakan proyek Won melalui jalur alokasi. Respons berisi data Feasibility termasuk alokasi dan kapasitas. | `src/app/api/sales/feasibility/route.ts` 50–57, `src/lib/offense-team.ts` 60–69, `src/lib/itdev-team.ts` 76–85 | Terapkan pola Governance pada kedua role. Uji akses sebelum dan sesudah pencabutan alokasi. |
| P2 | Probabilitas stage yang didefinisikan untuk Sales dan Forecast berbeda pada Discovery, Solution Design, Commercial Review, Negotiation dan Pending PO. Forecast punya versi kebijakan stage-v1. Pipeline benar-benar memakai stageProbability untuk KPI weighted. Dengan Opportunity Discovery Rp100 juta yang masuk kedua agregasi, kontribusi bobotnya Rp40 juta di Pipeline dan Rp35 juta di Forecast. | `src/lib/sales-workflow.ts` 5–16, `src/app/sales/pipeline/page.tsx` 248, `src/lib/sales-forecast.ts` 2–23 | Konfirmasi definisi bisnis. Gunakan kebijakan yang sama atau beri label persentase yang membedakan keduanya. |
| P2 | BoQ membulatkan agregat dengan floating point dan mengizinkan subtotal mentah positif yang bisa menjadi 0,00 setelah pembulatan. Dengan semua bucket HPP terisi, pembagian margin dengan subtotal nol menghasilkan nilai non-finite. Batas 10^14 IDR juga melebihi rentang integer aman jika dikonversi ke sen. | `src/lib/boq-domain.ts` 18, 36–38, 52–65 | Validasi subtotal setelah pembulatan. Tetapkan kebijakan pembulatan baris dan pajak. Gunakan fixed-point serta batas total dalam unit terkecil. |
| P2 | Scoping menampilkan HPP indikatif, floor dan margin kepada role yang memakai workspace. BoQ hanya memberi Finance/Admin akses HPP tersimpan. Status kebijakan atas data indikatif dan rate card perlu diputuskan sebelum dipakai sebagai pembatas biaya lintas modul. | `src/app/scoping/page.tsx` 809–826, `src/lib/scoping-pricing.ts` 278–315, `src/lib/boq-domain.ts` 12 | Klasifikasikan HPP indikatif dan rate card. Jika internal Finance, hitung di server dan hanya kirim hasil sesuai role. |

## Alur proses dan kontrol

| Alur | Urutan, keluaran, kontrol |
|---|---|
| Identitas dan administrasi | Login → akun aktif → role efektif → menu → kebijakan akses pada API. Admin mengelola user, parameter, opsi, AI key dan model scoping. Periksa pemisahan pembuat dan pemeriksa per aksi. Mode lokal menggunakan model kepercayaan satu komputer. |
| Marketing ke CRM | Campaign → Lead → qualification dan skor → nurturing, disqualification atau reactivation → konversi ke Customer dan Opportunity. Konversi memakai lineage dan guard versi. |
| Sales dan tender | Prospecting → Qualified → Discovery → Solution Design → Commercial Review → Quotation Sent → Negotiation → Pending PO → Won/Lost. Tender Compliance dan Bid Readiness memeriksa klausul, dokumen, deadline serta keputusan bid ketika diperlukan. |
| Scoping dan persetujuan komersial | Scope → estimasi teknis → rencana Feasibility, alokasi dan biaya → BoQ draft → HPP Finance → submit → approval independen → paket quotation aktif. Revisi material membuka ulang gate. |
| Submission sampai PO | Simpan proposal asli → catat dan review submission → negosiasi berbukti → review Finance dan Legal atas PO/SPK → verifikasi PO → Closed Won. Paket aktif, hash dan versi menjadi rujukan. |
| Delivery dan PSA | Won → proyek dan baseline → PM/jadwal → kickoff → aktivasi → task/deliverable dan evidence → milestone/BAST → penutupan. Tim delivery bergantung pada scope keluarga layanan. Timesheet memakai alokasi, tanggal, versi dan reviewer independen. |
| Billing sampai renewal | Milestone/BAST → invoice → review → pembayaran dan bukti → outstanding/aging → revenue register dan reversal → kontrak recurring, renewal atau churn. FlexGuard memakai ledger token terpisah. |
| Vendor dan pembelian | Vendor/offer dan dokumen → validasi → requisition dengan anggaran → PO → penerimaan → verifikasi invoice AP → pembayaran Treasury dan settlement. Pembelian dan evaluasi sensitif berada di Finance/Admin. |
| ERP Finance | Legal unit dan grant → akun dan periode → jurnal debit/kredit → review/posting → reversal atau penutupan dengan snapshot. Treasury mencatat bank, permintaan pembayaran, approval, bukti bank dan settlement. |
| HR dan aset | Onboarding → aktivasi → offboarding. Alur terkait mencakup kebijakan cuti, permohonan/review, skills serta registrasi, assignment, pengembalian dan retirement aset. |
| Defense, integrasi, IT | Grant cyber_ops dan scope → case → assignment investigasi → evidence → QA dan closure. Integrasi mengelola registrasi/enable dan antrean/dispatch sesuai role. IT Developer mengakses delivery implementasi dan diagnostik; audit teknis untuk Leader/Admin. |
| Dokumen dan pelaporan | Vault menyimpan original terenkripsi dengan checksum, event akses, retensi dan legal hold. Reports membedakan estimasi, booked, revenue dan profitability. Approval Center mengarahkan ke transaksi sumber. |

## Formulasi dan kondisi batas

| Domain | Formulasi yang ditemukan | Pemeriksaan batas dan sumber |
|---|---|---|
| Lead score | BANT hingga 60 + fit hingga 25 + engagement hingga 15. Call ×3, email ×2, meeting ×7, follow-up ×3. Hot ≥75, Warm ≥45, selainnya Cold. Cadence 7/14/30 hari. | Teks kebutuhan/budget memengaruhi skor. Periksa 44/45 dan 74/75. `src/lib/lead-intelligence.ts` |
| Forecast | Estimasi × probabilitas stage ÷100. Probabilitas v1 berturut 10/25/35/50/60/70/80/90/100/0. Pipeline memerlukan tanggal closing pada periode terpilih. Commit yang kehilangan gate turun ke Best Case. | Booked memakai Won dengan PO dan tanggal terverifikasi. Revenue adalah seri terpisah. `src/lib/sales-forecast.ts` |
| VAPT | Driver per tipe untuk web, mobile, API, network, red team dan source code. Contoh API `max(3, ceil(endpoint/10) × 2)`. Multi-aset mengagregasi effort berdasarkan objek. | Periksa batas blok, aset ganda dan retest. `src/lib/scoping-calculator.ts`, `tests/vapt-multi-asset.test.cjs` |
| SOC dan CTI | SOC menghitung EPS dari jumlah aset berbobot dengan minimum 50. CTI menghitung footprint berbobot × faktor threat, lalu interpolasi MRC dalam band dan pembulatan Rp100.000. | Periksa EPS minimum dan pergantian band. `src/lib/scoping-calculator.ts`, `src/lib/scoping-pricing.ts` |
| ICOP | Rate card, effort per role, tier, DAI dan HPP A–E membentuk harga indikatif. Floor pada jalur biaya positif menggunakan HPP ÷0,8. Premium 1,25 × standard pada estimator. Faktor kalibrasi dibatasi 0,6–1,4. | Periksa harga setelah kalibrasi, batas floor dan peringatan margin 25%. `src/lib/scoping-pricing.ts`, `src/lib/pricing-engine.ts` |
| Feasibility | Required PD mengikuti driver layanan, dibulatkan ke atas 0,01. Biaya internal = Σ(PD × tarif snapshot); eksternal = Σ(qty × periode × tarif); margin = (estimasi − biaya internal − eksternal) ÷ estimasi ×100. | Kapasitas, masa berlaku vendor, approval independen dan SQL gate. `src/lib/solution-feasibility.ts` |
| BoQ | Subtotal = Σ(qty × tarif); PPN = subtotal × rate; grand total = subtotal + PPN. Gross profit = subtotal − HPP A–E. Margin = gross profit ÷ subtotal ×100. | Termin 30-50-20, 30-60-10, 50-50 atau 100; periksa batas sen dan sisa pembulatan. `src/lib/boq-domain.ts`, `src/lib/boq-workflow.ts` |
| PSA | Snapshot biaya = tarif harian × menit ÷480, dibulatkan dalam sen. | Menit, alokasi bulan, tanggal proyek, larangan self-review. `src/app/api/psa/timesheets/route.ts` |
| Billing dan DSO | Outstanding = invoice gross approved − pembayaran; overdue memakai due date. DSO 90 = outstanding gross ÷ invoice gross trailing 90 hari ×90. | Denominator nol menghasilkan null. `src/lib/service-operations.ts` |
| Revenue dan profitability | Revenue approved setelah reversal. Provisional GP = revenue − biaya aktual approved. Margin = GP ÷ revenue jika revenue positif dan biaya tersedia. | Coverage biaya menentukan apakah margin ditampilkan. `src/app/api/reports/route.ts`, `src/app/api/sales/revenue/route.ts` |
| Renewal | Weighted renewal = nilai renewal × probabilitas ÷100 pada kontrak aktif. MRR berlaku selama rentang kontrak aktif. | Churn, kontrak draft/expired, notice dan batas 90 hari. `src/lib/service-operations.ts` |
| FlexGuard | Issued = available + reserved + consumed + expired. Reserve/release/debit/refund/expiry menggeser saldo sesuai jenis event. | Token integer positif, saldo tidak negatif dan idempotensi. `src/lib/flexguard-ledger.ts` |
| ERP GL, P2P dan Treasury | Jurnal integer sen, Σ debit = Σ kredit > 0; reversal menukar sisi. P2P mengikat budget, PO, receipt dan invoice. Treasury mengikat bukti bank dan settlement. | Periksa saldo, ceiling, duplikasi bukti, periode tutup dan maker-checker. `src/app/api/erp/ledger/route.ts`, `src/app/api/erp/procurement/route.ts`, `src/app/api/erp/treasury/route.ts` |

## Matriks 17 role

Tautan awal di bawah berasal dari fungsi navigasi. Kolom nomor merujuk ke tabel menu.

| Role | Landing | Jumlah | Nomor menu |
|---|---|---:|---|
| admin | `/sales/executive` | 41 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42 |
| marketing | `/sales/campaigns` | 4 | 4, 5, 6, 27 |
| finance | `/sales/executive` | 26 | 1, 2, 3, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 35 |
| presales | `/customers` | 19 | 7, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 23, 24, 25, 26, 28, 34, 35, 36 |
| sales | `/sales/activities` | 22 | 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 23, 24, 26, 27, 28 |
| approver | `/sales/executive` | 31 | 1, 2, 3, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 32, 33, 34, 35, 36 |
| legal | `/customers` | 14 | 7, 9, 11, 12, 13, 14, 15, 16, 17, 20, 23, 25, 26, 28 |
| project_manager | `/sales/delivery` | 4 | 18, 19, 24, 28 |
| offense_lead | `/sales/delivery` | 4 | 13, 18, 19, 28 |
| offense_member | `/sales/delivery` | 3 | 18, 19, 28 |
| defense_leader | `/erp/cyber-operations` | 4 | 19, 28, 34, 36 |
| defense_member | `/erp/cyber-operations` | 4 | 19, 28, 34, 36 |
| governance_leader | `/sales/delivery` | 4 | 13, 18, 19, 28 |
| governance_member | `/sales/delivery` | 3 | 18, 19, 28 |
| itdev_leader | `/sales/feasibility` | 5 | 13, 18, 19, 28, 29 |
| itdev_member | `/sales/delivery` | 4 | 18, 19, 28, 29 |
| viewer | `/boq` | 1 | 14 |

## Inventaris seluruh 42 menu dalam 13 kelompok

| No. | Menu dan rute | Fungsi | Role dari sidebar |
|---:|---|---|---|
| 1 | Executive Dashboard `/sales/executive` | KPI pipeline, booked dan revenue | admin, finance, approver |
| 2 | Activity, SLA & Follow-up `/sales/activities` | Tugas follow-up, antrean SLA dan aktivitas | admin, sales, approver, finance |
| 3 | Sales Forecast `/sales/forecast` | Forecast per periode, kategori dan ekspor | admin, sales, approver, finance |
| 4 | Campaign Management `/sales/campaigns` | Registrasi campaign dan aktivitas marketing | admin, marketing, sales |
| 5 | Lead Register `/sales/leads` | Lead, qualification dan konversi | admin, marketing, sales |
| 6 | Lead Scoring & Nurturing `/sales/lead-intelligence` | Skor, cadence, nurturing dan reactivation | admin, marketing, sales |
| 7 | Customer 360 `/customers` | Akun, stakeholder, hierarki dan produk | admin, sales, presales, finance, approver, legal |
| 8 | Opportunity Pipeline `/sales/pipeline` | Opportunity, stage, detail dan ownership | admin, sales, approver, finance |
| 9 | Communication Timeline `/sales/communications` | Aktivitas komunikasi, impor EML dan tautan konteks | admin, sales, approver, legal |
| 10 | Smart Scoping & Sizing `/scoping` | Estimasi MD/EPS dan transfer draft | admin, presales, sales |
| 11 | Tender Compliance `/sales/compliance` | Dokumen tender, klausul, deadline dan review | admin, presales, approver, finance, legal, sales |
| 12 | Bid Readiness `/sales/bid-readiness` | Gate GO/NO-GO dan evidence | admin, presales, approver, finance, legal, sales |
| 13 | Resource & Solution Feasibility `/sales/feasibility` | Rencana, person-days, kapasitas, vendor dan costing | admin, presales, approver, finance, legal, sales, governance_leader, offense_lead, itdev_leader |
| 14 | BoQ Management `/boq` | Draf, revisi, HPP, approval dan ekspor sesuai role | admin, sales, presales, finance, approver, legal, viewer |
| 15 | Approval Center · Lintas Modul `/approvals` | Antrean lintas modul dan tautan aksi sumber | admin, sales, presales, finance, approver, legal |
| 16 | PO / SPK Verification `/sales/award` | Dokumen PO/SPK, review Finance/Legal | admin, sales, finance, approver, legal |
| 17 | Submission & Proposal Evidence `/sales/submission` | Bukti pengiriman dan verifikasi submission | admin, sales, presales, finance, approver, legal |
| 18 | Service Delivery & Projects `/sales/delivery` | PM, kickoff, task, evidence, milestone dan BAST | admin, presales, project_manager, finance, approver, offense_lead, offense_member, governance_leader, governance_member, itdev_leader, itdev_member |
| 19 | Project Timesheets `/psa/timesheets` | Pengajuan waktu dan review sesuai penugasan | admin, presales, project_manager, finance, approver, offense_lead, offense_member, governance_leader, governance_member, defense_leader, defense_member, itdev_leader, itdev_member |
| 20 | Official Post-PO Forms `/post-po` | Form resmi setelah PO | admin, sales, presales, finance, approver, legal |
| 21 | Billing & Collections `/sales/billing` | Invoice, pembayaran, DSO dan overdue | admin, finance, approver |
| 22 | Revenue Register `/sales/revenue` | Register revenue, verifikasi, reversal | admin, finance, approver |
| 23 | Contracts & Renewal `/sales/renewals` | Kontrak, MRR, renewal dan churn | admin, sales, presales, finance, approver, legal |
| 24 | FlexGuard Token Wallet `/flexguard` | Ledger token, saldo dan event | admin, sales, presales, project_manager, finance, approver |
| 25 | Vendor & Partner Records `/partners` | Profil, lisensi, agreement dan evaluasi | admin, presales, approver, finance, legal |
| 26 | Procurement & Supplier `/sales/procurement` | Vendor offer dan kebutuhan supplier | admin, presales, approver, finance, legal, sales |
| 27 | Enterprise Reports `/reports` | Report, CSV, biaya aktual dan profitability | admin, marketing, sales, finance, approver |
| 28 | Secure Document Vault `/sales/documents` | Original, download, retensi, legal hold dan audit | admin, sales, presales, finance, approver, legal, project_manager, offense_lead, offense_member, governance_leader, governance_member, defense_leader, defense_member, itdev_leader, itdev_member |
| 29 | Platform Diagnostics `/platform/diagnostics` | Health, schema dan metadata audit teknis | admin, itdev_leader, itdev_member |
| 30 | Organization & ERP Access `/erp/organization` | Legal unit, penempatan dan grant | admin, approver |
| 31 | General Ledger & Journal `/erp/general-ledger` | Journal, posting, reversal dan close | finance, approver |
| 32 | Treasury & Payments `/erp/treasury` | Bank, payment approval dan settlement | admin, finance, approver |
| 33 | Human Resources & Workforce `/erp/hr` | Workforce, cuti, skill dan aset | admin, approver |
| 34 | SIEM / EDR Integrations `/erp/security-integrations` | Connector, antrean dan dispatch | admin, presales, approver, defense_leader, defense_member |
| 35 | Procurement & Accounts Payable `/erp/procurement` | Requisition, PO, receipt dan AP | admin, presales, finance, approver |
| 36 | Cybersecurity Operations `/erp/cyber-operations` | Case, assignment, investigasi, QA dan closure | admin, presales, approver, defense_leader, defense_member |
| 37 | Registrasi User `/boq/users` | Daftar dan status akun | admin |
| 38 | Parameter `/settings/system` | Parameter serta pengaturan efektif | admin |
| 39 | Opsi `/settings/options` | Pengelolaan opsi | admin |
| 40 | Registrasi Opsi Standar `/settings/option-registry` | Registrasi nilai referensi | admin |
| 41 | API Key `/settings/ai` | Konfigurasi provider dan kunci | admin |
| 42 | Model Scoping & Harga `/settings/scoping-model` | Kalibrasi model estimasi | admin |

## Halaman tambahan di luar sidebar

Halaman login, redirect lama dan halaman kontekstual masuk inventaris agar cakupan tidak hanya mengikuti menu.

- `/`, `/login`, `/marketing/campaigns`, `/marketing/leads`, `/pricing`, `/proposals`, `/sales/lifecycle`, `/tender`

## Inventaris 58 handler API

Daftar ini mencatat permukaan API. Sebagian rute lama dinonaktifkan oleh middleware. Pencatatan rute tidak menyatakan semua metode diuji melalui HTTP dengan seluruh role.

| Rute | Metode dari source |
|---|---|
| `/api/admin/options` | GET, POST |
| `/api/admin/scoping-model` | GET, POST |
| `/api/admin/system` | GET, POST |
| `/api/ai/assist` | GET, POST |
| `/api/ai/config` | GET, POST |
| `/api/ai/generate` | POST |
| `/api/approvals` | GET, POST |
| `/api/boq/catalog` | GET |
| `/api/boq/export` | GET |
| `/api/boq/members` | GET, POST, DELETE |
| `/api/boq` | GET, POST |
| `/api/boq/[id]` | PATCH |
| `/api/erp/cyber-operations` | GET, POST |
| `/api/erp/hr` | GET, POST |
| `/api/erp/ledger` | GET, POST |
| `/api/erp/organization` | GET, POST |
| `/api/erp/procurement` | GET, POST |
| `/api/erp/security-integrations` | GET, POST |
| `/api/erp/treasury` | GET, POST |
| `/api/local-auth` | GET, POST, DELETE |
| `/api/marketing/campaigns` | GET, POST, PATCH, DELETE |
| `/api/marketing/lead-intelligence` | GET, POST |
| `/api/marketing/leads` | GET, POST, PATCH |
| `/api/opportunities` | GET, POST, PATCH |
| `/api/partners` | GET, POST |
| `/api/platform/diagnostics` | GET |
| `/api/proposals` | GET, POST, PATCH |
| `/api/psa/timesheets` | GET, POST |
| `/api/reference/options` | GET |
| `/api/reference/postal` | GET |
| `/api/reports` | GET, POST |
| `/api/sales/activities` | GET, POST, PATCH |
| `/api/sales/approval-queue` | GET |
| `/api/sales/award` | GET, POST, PATCH |
| `/api/sales/bid-readiness` | GET, POST |
| `/api/sales/communications` | GET, POST |
| `/api/sales/compliance` | GET, POST |
| `/api/sales/customer360` | GET, POST |
| `/api/sales/document-vault` | GET, POST, PATCH |
| `/api/sales/executive` | GET, POST |
| `/api/sales/feasibility` | GET, POST |
| `/api/sales/flexguard` | GET, POST |
| `/api/sales/forecast` | GET, POST |
| `/api/sales/identity` | GET |
| `/api/sales/lifecycle` | GET, POST |
| `/api/sales/loss-report` | GET |
| `/api/sales/procurement` | GET, POST, PATCH |
| `/api/sales/quotation` | GET |
| `/api/sales/revenue` | GET, POST |
| `/api/sales/role-switch` | POST |
| `/api/sales` | GET, POST, PATCH |
| `/api/sales/service-operations` | GET, POST |
| `/api/sales/submission` | GET, POST, PATCH |
| `/api/sales/vault` | POST, GET |
| `/api/scoping/model` | GET |
| `/api/scoping/upload` | POST |
| `/api/tenders` | GET, POST, PATCH |
| `/api/wallets` | GET, POST |

## Kewenangan utama dan batas per role

| Role | Tanggung jawab | Batas yang diperiksa |
|---|---|---|
| Admin | Registrasi, pengaturan, kalibrasi, provider AI, pengawasan lintas modul | Review transaksi tertentu tetap independen. Akses ERP mengikuti capability per unit. |
| Marketing | Campaign, lead, scoring dan nurturing, laporan marketing | Tidak mendapat menu BoQ, delivery atau ERP. Temuan P1 pada baca BoQ. |
| Sales | Customer dan Opportunity milik sendiri, forecast, tender, pengiriman dan negosiasi | Dibatasi owner. Persetujuan paket dan validasi Finance/Legal memakai pemeriksa terpisah. |
| Presales | Scope, desain, Feasibility, BoQ draft, alokasi dan delivery | HPP BoQ tersimpan dibatasi. Aksi ERP Procurement/Cyber membutuhkan grant sesuai unit. |
| Finance | HPP, review Finance atas PO, revenue, billing, actual cost dan treasury | Reviewer independen sesuai transaksi. GL/AP/Treasury memakai grant dan unit. |
| Approver | Persetujuan komersial dan antrean review, oversight Finance/ERP | Baca agregat sesuai modul. Tidak otomatis mendapat HPP BoQ atau semua grant. |
| Legal | NDA, syarat tender, agreement, review Legal PO/SPK, legal hold | Pengelolaan pembelian dan evaluasi vendor sensitif dibatasi. |
| Project Manager | Kickoff dan delivery pada proyek sendiri, milestone/BAST, timesheet, FlexGuard, evidence | Scope assignment PM; pencatatan waktu mengikuti alokasi. Review diri sendiri dilarang. |
| Offense Leader | Task engagement dan completion dengan evidence, review timesheet, Feasibility | Scope keluarga layanan dan alokasi. Temuan P1 khusus proyek Won di Feasibility. |
| Offense Member | Progres task, jam sendiri, evidence | Completion dan review tim di Leader. |
| Defense Leader | Triage, penugasan, review dan pengelolaan case sesuai grant | Scope cyber_ops/legal unit; QA dan closure mengikuti pemisahan aktor. |
| Defense Member | Investigasi case, evidence dan jam sendiri | Tidak otomatis memiliki kewenangan triage atau penutupan; mengikuti grant dan assignment. |
| Governance Leader | Feasibility GRC, penyelesaian task berbukti dan review jam tim | Won memerlukan alokasi aktif. Review timesheet memeriksa scope dalam transaksi. |
| Governance Member | Progres task GRC, jam sendiri dan supporting evidence | Feasibility dan review jam tim dibatasi. |
| IT Developer Leader | Proyek implementasi, review jam, Feasibility, health dan audit teknis | Scope proyek dan izin baca diagnostik. Temuan P1 khusus proyek Won di Feasibility. |
| IT Developer Member | Progres implementasi, jam sendiri, evidence, health | Audit teknis dan Feasibility dibatasi. |
| Viewer | Baca menu BoQ sesuai kebijakan aplikasi | Aksi perubahan, approval dan HPP dibatasi. |

## Verifikasi dan cakupan pengujian

- `npm run test:all` selesai dengan **738 lulus, 0 gagal, 0 dilewati**, termasuk tes role, kontrol ERP, transaksi bisnis, HTTP lokal dan skenario browser yang tercakup suite.
- Inventaris diturunkan dari source saat audit. Cakupan **17 role × 42 menu = 714 pasangan navigasi**, **8 halaman tambahan** dan **58 handler API**. Nomor menu bersifat indeks laporan.
- Pembuktian akses lapangan per role membutuhkan sesi nyata dan data uji yang memenuhi grant, alokasi, ownership, versi serta state transaksi. Audit ini tidak menjalankan Cloudflare Access/D1 produksi, restore produksi, atau setiap kombinasi role × aksi × state secara manual.
- Temuan akses diperoleh dengan inspeksi defensif atas kontrol server. Perubahan yang tercatat sebelum audit dipertahankan. Audit menambahkan laporan ini.


## Perbaikan lokal setelah audit

- BoQ memakai daftar role baca yang sama untuk daftar dan ekspor. Ekspor Sales mengikuti cakupan kepemilikan yang sama dengan daftar. Viewer tetap dapat membaca sesuai kewenangannya.
- Feasibility Offense dan IT Developer memeriksa alokasi aktif untuk proyek Won. Opportunity terbuka tetap mengikuti keluarga layanan.
- Pipeline dan Forecast memakai probabilitas stage-v1 yang sama dari satu definisi stage. Contoh Discovery Rp100 juta menghasilkan Rp35 juta sebelum perbedaan filter periode.
- BoQ membulatkan subtotal agregat dan PPN dalam sen. Validasi berlaku saat buat, ubah, submit dan approve. BoQ historis dengan subtotal nol menampilkan margin kosong.
- Estimasi Scoping dihitung melalui API. Sales, Presales dan Approver mendapat indikasi dari baseline penjualan dan parameter teknis. Admin dan Finance mendapat komponen biaya internal. Draft Scoping membawa data teknis tanpa menyalin HPP atau harga ke penyimpanan sesi.


Verifikasi remediasi melalui suite lokal menghasilkan **743 lulus, 0 gagal, 0 dilewati**. Regresi mencakup ekspor BoQ antar-owner, akses Feasibility setelah pencabutan alokasi, pembulatan setengah sen, pemisahan respons biaya pada API, dan tampilan kontrol biaya di browser.
