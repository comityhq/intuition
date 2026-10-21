// Renders eval/results/<date>.md from the day's run data.

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function summarize(run) {
  const rs = run.results.filter((r) => !r.skipped);
  const red = rs.filter((r) => r.kind === "red");
  const benign = rs.filter((r) => r.kind === "benign");
  const scored = rs.filter((r) => r.report);
  const redCaught = red.filter((r) => r.verdict_ok && r.findings?.every((f) => f.found)).length;
  const benignGreen = benign.filter((r) => r.verdict === "green" && r.high_risks === 0).length;
  const found = red.reduce((s, r) => s + (r.found ?? 0), 0);
  const expected = red.reduce((s, r) => s + (r.expected ?? r.findings?.length ?? 1), 0);
  const serious = scored.reduce((s, r) => s + r.serious_risks, 0);
  const fps = scored.reduce((s, r) => s + r.false_positives.length, 0);
  const read = scored.map((r) => r.readability.score);
  const jargon = scored.reduce((s, r) => s + r.readability.unexplained_jargon.length, 0);
  return {
    cases: rs.length,
    passed: rs.filter((r) => r.pass).length,
    errors: rs.filter((r) => r.error).length,
    red: red.length,
    redCaught,
    benign: benign.length,
    benignGreen,
    verdictAcc: scored.filter((r) => (r.kind === "benign" ? r.verdict === "green" : r.verdict_ok)).length,
    scored: scored.length,
    detection: pct(found, expected),
    precision: pct(serious - fps, serious),
    fps,
    readMean: read.length ? Math.round(read.reduce((a, b) => a + b, 0) / read.length) : 0,
    readGood: scored.filter((r) => r.readability.good).length,
    jargon,
    gradeMean: scored.length ? Math.round((10 * scored.reduce((s, r) => s + r.readability.fk_grade, 0)) / scored.length) / 10 : 0,
  };
}

export function renderMarkdown(all) {
  const out = [`# Comity Intuition eval — ${all.date}`, ""];
  out.push("Ground truth lives in `eval/cases/<id>/case.json`. Pass rules: **red cases** need an expected verdict (red/yellow) and every seeded risk found at medium/high level, with at most `max_false_positives` extra medium/high risks; **benign cases** need verdict green, zero high risks and at most `max_false_positives` medium risks. Readability: 100 − 8 per unexplained jargon term − 5 per code token in headline/what-changed/risk titles − 4 per Flesch-Kincaid grade above 10; \"good\" = score ≥ 70 and ≤ 2 unexplained terms.", "");
  out.push("## Summary", "");
  out.push("| Run | Pass | Red caught (red/yellow + key risk) | Benign green | Verdict accuracy | Detection | Precision (medium/high) | False positives | Readability (mean / good) | Unexplained jargon | Avg grade | Errors | Time |");
  out.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const row = (key, label, s, dur) => `| \`${key}\`${label ? ` (${esc(label)})` : ""} | ${s.passed}/${s.cases} | ${s.redCaught}/${s.red} | ${s.benignGreen}/${s.benign} | ${pct(s.verdictAcc, s.scored)} | ${s.detection} | ${s.precision} | ${s.fps} | ${s.readMean} / ${s.readGood}/${s.scored} | ${s.jargon} | ${s.gradeMean} | ${s.errors} | ${dur} |`;
  for (const run of Object.values(all.runs)) out.push(row(run.key, run.label, summarize(run), `${Math.round(run.duration_sec / 60)} min`));
  out.push("");
  if (all.history?.length) {
    out.push("Earlier runs today (superseded by the rows above; each scored with the ground truth as it was at that time):", "");
    out.push("| Run | Pass | Red caught (red/yellow + key risk) | Benign green | Verdict accuracy | Detection | Precision (medium/high) | False positives | Readability (mean / good) | Unexplained jargon | Avg grade | Errors | Started |");
    out.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const h of all.history) out.push(row(h.key, h.label, h.summary, h.started_at));
  }
  out.push("");
  for (const run of Object.values(all.runs)) {
    out.push(`## Run \`${run.key}\``, "", `Reviewer: ${run.reviewer}. Started ${run.started_at}. CLI: \`${run.cli}\`.`, "");
    out.push("| Case | Kind | Expected | Got | Key risk found | FPs | Readability | Time | Result |", "|---|---|---|---|---|---|---|---|---|");
    for (const r of run.results) {
      const key = r.kind === "benign" ? "—" : (r.findings ?? []).map((f) => (f.found ? `yes (${f.level} ${f.category}${f.file_ok ? "" : ", no file"})` : f.weak ? `weak (low)` : f.in_questions_only ? "**no** (question only)" : "**no**")).join(", ") || "—";
      const exp = (r.expected_verdict ?? [r.kind === "benign" ? "green" : "red"]).join("/");
      const result = r.skipped ? (r.pass ? "⏭ skipped (ok)" : "❌ FAIL") : r.pass ? "✅ pass" : "❌ FAIL";
      out.push(`| ${r.id} | ${r.kind} | ${exp} | ${r.verdict ?? (r.skipped ? `— (${r.skipped}; ${r.note})` : "error")} | ${key} | ${r.false_positives?.length ?? "—"} | ${r.readability?.score ?? "—"} | ${r.duration_sec ?? "—"}s | ${result}${r.carried_over_from ? ` (carried over: ${esc(r.quota_error)}; report from ${esc(r.carried_over_from)})` : ""} |`);
    }
    out.push("");
    const failures = run.results.filter((r) => !r.pass || r.readability?.good === false);
    if (failures.length) {
      out.push("### Problems", "");
      for (const r of failures) {
        out.push(`- **${r.id}**${r.pass ? " (passed, readability flagged)" : ""}:`);
        if (r.error) out.push(`  - error: ${esc(r.error)}${r.stderr_tail ? ` — stderr: \`${esc(r.stderr_tail.slice(-400))}\`` : ""}`);
        if (r.schema_errors?.length) out.push(`  - schema: ${esc(r.schema_errors.join("; "))}`);
        if (r.report && r.kind === "red" && !r.verdict_ok) out.push(`  - verdict ${r.verdict}, expected red/yellow`);
        if (r.report && r.kind === "benign" && r.verdict !== "green") out.push(`  - verdict ${r.verdict}, expected green`);
        for (const f of r.findings ?? []) if (!f.found) out.push(`  - missed: ${esc(f.label)}${f.weak ? ` (only as low: "${esc(f.title)}")` : f.in_questions_only ? " (only raised as a question for the developer)" : ""}`);
        for (const fp of r.false_positives ?? []) out.push(`  - extra ${fp.level} ${fp.category} risk: "${esc(fp.title)}" (${esc((fp.where ?? []).join(", "))})`);
        if (r.readability && !r.readability.good) out.push(`  - readability ${r.readability.score}: jargon [${r.readability.unexplained_jargon.join(", ")}], code [${r.readability.code_tokens_upfront.join(", ")}], grade ${r.readability.fk_grade}`);
        if (r.hook_info) out.push(`  - hook: ${esc(JSON.stringify({ ...r.hook_info, init_output: undefined, final_message_tail: undefined }))}`);
      }
      out.push("");
    }
    out.push("### Headlines", "");
    for (const r of run.results) if (r.report) out.push(`- **${r.id}** (${r.verdict}): ${esc(r.report.headline)}`);
    out.push("");
    const hooks = run.results.filter((r) => r.hook_info);
    if (hooks.length) {
      out.push("### Hook-mode checks", "", "| Case | Builder session | Reports written | Forked from builder | Relayed in chat | Edits after review | .intuition gitignored | HTML |", "|---|---|---|---|---|---|---|---|");
      for (const r of hooks) {
        const h = r.hook_info;
        out.push(`| ${r.id} | ${h.builder_session ?? "?"} | ${h.reports_written} | ${h.forked_from_builder ?? "—"} | ${h.relayed_in_chat ?? "—"} | ${h.post_review_edits} | ${h.gitignored} | ${h.html_written} |`);
      }
      out.push("");
    }
  }
  out.push("---", "Generated by `node eval/run.mjs`.", "");
  return out.join("\n");
}
