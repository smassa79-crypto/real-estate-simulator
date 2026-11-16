// 計算ロジックの検算テスト。
// 実行方法（どちらでも同じテストが走る）
//   ・ブラウザ：index.html?selftest を開く（結果が画面の先頭に出る）
//   ・Node.js ：node tests/calc.test.js
// 期待値は、index.html とは別に Python（Decimal の閉形式）で求めた値。
(function () {
  const isNode = typeof window === 'undefined';
  const NAMES = ['calcPmt', 'simulateLoan', 'calcPv', 'simulateBullet', 'famMonthlyPmt', 'famBalloonYear',
    'simulateFamily', 'familyAllocation', 'calcNoi', 'calcStages', 'calcPaybackYears', 'sensPeriodYears',
    'minCfInSensPeriod', 'solveRequiredRent', 'solveMaxBankRate', 'scenarioRateForYear', 'simulateYears',
    'solveMaxPrice', 'auctionTerms', 'inputsAtPrice', 'solveBidLimit'];
  let api;
  if (isNode) {
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const cfgSrc = html.match(/<script>\s*(const DEFAULT_CONFIG[\s\S]*?)<\/script>/)[1];
    const calcSrc = html.match(/\/\/ === CALC-BEGIN ===[^\n]*\n([\s\S]*?)\/\/ === CALC-END ===/)[1];
    api = vm.runInNewContext(`${cfgSrc}\n${calcSrc}\n({ DEFAULT_CONFIG, ${NAMES.join(', ')} })`);
  } else {
    // index.html のグローバルから取り出す（この関数内の同名の const と衝突しないよう、グローバルスコープで評価する）
    api = new Function(`return { DEFAULT_CONFIG, ${NAMES.join(', ')} };`)();
  }
  const { DEFAULT_CONFIG: CFG, calcPmt, simulateLoan, calcPv, simulateBullet, famMonthlyPmt, famBalloonYear,
    familyAllocation, calcStages, calcPaybackYears, minCfInSensPeriod, solveRequiredRent, solveMaxBankRate,
    scenarioRateForYear, simulateYears, solveMaxPrice, auctionTerms, inputsAtPrice, solveBidLimit } = api;

  const results = [];
  let group = '';
  const section = (name) => { group = name; };
  const check = (name, ok, detail) => results.push({ group, name, ok: !!ok, detail: detail || '' });
  const near = (name, actual, expected, tol) => check(name, Math.abs(actual - expected) <= (tol === undefined ? 0.01 : tol),
    `実際 ${actual} / 期待 ${expected}`);
  const sum = (rows, key) => rows.reduce((t, r) => t + r[key], 0);

  // 融資条件（依頼の条件）：信金 単独1,700万／共同担保2,500万・3.375%・15年、公庫 4.55%・10年
  const BANK_RATE = 3.375, BANK_YRS = 15, KOKO_RATE = 4.55, KOKO_YRS = 10;
  // Python で独立に求めた月額返済（円）
  const PMT_1700 = 120489.1755, PMT_2500 = 177189.9640, PMT_K600 = 62327.7598, PMT_K300 = 31163.8799;

  // 入力値のひな形：家賃20万・運営経費率20%（NOI 16万円）、信金＋公庫、親族借入なし
  const base = (over) => Object.assign({
    hasFam: false, famAmt: 0, famRate: 0, famYrs: 0, famMethod: 'amortize',
    rentMan: 20, opexRate: 0.2,
    bankAmt: 1700, bankRate: BANK_RATE, bankYrs: BANK_YRS,
    hasEq: true, eqAmt: 600, eqRate: KOKO_RATE, eqYrs: KOKO_YRS
  }, over || {});
  const NOI = 160000;

  section('設定値');
  check('信金の借入上限 単独1,700万／共同2,500万', CFG.bank.cap === 1700 && CFG.bank.capJoint === 2500);
  check('信金 3.375%・15年', CFG.bank.rate === 3.375 && CFG.bank.years === 15);
  check('公庫 4.55%・10年', CFG.kokoEq.rate === 4.55 && CFG.kokoEq.years === 10);

  section('返済額（元利均等）');
  near('信金 1,700万 の月額返済', calcPmt(1700e4, BANK_RATE, BANK_YRS), PMT_1700);
  near('信金 2,500万 の月額返済', calcPmt(2500e4, BANK_RATE, BANK_YRS), PMT_2500);
  near('公庫 600万 の月額返済', calcPmt(600e4, KOKO_RATE, KOKO_YRS), PMT_K600);
  near('金利0%は元金÷回数', calcPmt(1000e4, 0, 15), 1000e4 / 180, 1e-6);
  near('返済額から元金を逆算（calcPv）', calcPv(PMT_1700, BANK_RATE, BANK_YRS), 1700e4, 1);
  {
    const rows = simulateLoan(1700, () => BANK_RATE, BANK_YRS, BANK_YRS);
    near('信金 1,700万 の総返済額 ＝ 月額×180回', sum(rows, 'payment'), PMT_1700 * 180, 1);
    near('5年目末の残債（閉形式と一致）', rows[4].balance, 12257119.44, 0.5);
    check('完済時の残債は 0', rows[14].balance === 0, `残債 ${rows[14].balance}`);
    const koko = simulateLoan(600, () => KOKO_RATE, KOKO_YRS, 15);
    near('公庫 600万 の5年目末の残債', koko[4].balance, 3339148.70, 0.5);
    check('公庫は11年目以降の返済・残債が 0', koko[10].payment === 0 && koko[10].balance === 0 && koko[9].balance === 0);
  }

  section('月次CF：信金＋公庫');
  {
    const s = calcStages(base());
    check('期間は 当初10年／11〜15年目 の2つ', s.length === 2 && s[0].toYr === 10 && s[1].fromYr === 10 && s[1].toYr === 15);
    near('単独1,700万：当初10年の月額返済', s[0].totalRepay, PMT_1700 + PMT_K600);
    near('単独1,700万：当初10年の月次CF', s[0].cf, -22816.94);
    near('単独1,700万：11〜15年目の月次CF', s[1].cf, 39510.82);
    const j = calcStages(base({ bankAmt: 2500 }));
    near('共同2,500万：当初10年の月次CF', j[0].cf, -79517.72);
    near('共同2,500万：11〜15年目の月次CF', j[1].cf, -17189.96);
    const years = simulateYears(base(), () => BANK_RATE, 15);
    near('年次の計算と一致（1年目の年間CF ＝ 月次CF×12）', years[0].cf, s[0].cf * 12, 0.01);
    near('年次の計算と一致（11年目）', years[10].cf, s[1].cf * 12, 0.01);
    near('15年間の累積CF', years[14].cumCf, NOI * 180 - PMT_1700 * 180 - PMT_K600 * 120, 1);
    check('15年目末の残債合計は 0', years[14].balance === 0);
  }

  section('月次CF：信金＋公庫＋親族借入');
  {
    // 落札2,500万・保証金358.8万・リフォーム600万。親族：落札額に400万・リフォームに300万（0%・15年・元利均等）
    const a = familyAllocation({ price: 400, reno: 300, other: 0 }, 2500, 358.8, 600);
    check('親族借入の配分（落札400万・リフォーム300万・手元0）', a.toPrice === 400 && a.toReno === 300 && a.toHand === 0);
    const inp = inputsAtPrice(base({ hasFam: true, famAmt: 700, famRate: 0, famYrs: 15, eqAmt: 600 - a.toReno }), 2500, 358.8, a.toPrice);
    near('信金借入 ＝ 2,500 − 358.8 − 400 ＝ 1,741.2万', inp.bankAmt, 1741.2, 1e-9);
    const s = calcStages(inp);
    const pBank = PMT_1700 * 1741.2 / 1700;
    near('信金の月額返済', s[0].repayBank, pBank);
    near('公庫300万の月額返済', s[0].repayEq, PMT_K300);
    near('親族700万（0%・15年）の月額返済', s[0].repayFam, 700e4 / 180);
    near('当初10年の月次CF', s[0].cf, NOI - pBank - PMT_K300 - 700e4 / 180);
    near('当初10年の月次CF（値）', s[0].cf, -33462.04);
    near('11〜15年目の月次CF（値）', s[1].cf, -2298.16);
    const years = simulateYears(inp, () => BANK_RATE, 15);
    near('総返済額 ＝ 3本の返済の合計', sum(years, 'repay'), pBank * 180 + PMT_K300 * 120 + 700e4, 1);
    check('15年目末の残債合計は 0', years[14].balance === 0);

    // 共同担保：信金2,500万＋公庫600万＋親族300万（手元資金・1%・10年・元利均等）
    const j = base({ bankAmt: 2500, hasFam: true, famAmt: 300, famRate: 1, famYrs: 10 });
    const sj = calcStages(j);
    near('共同2,500万＋公庫＋親族300万(1%・10年)：親族の月額返済', sj[0].repayFam, 26281.24);
    near('同：当初10年の月次CF', sj[0].cf, NOI - PMT_2500 - PMT_K600 - 26281.24, 0.02);
    near('同：11〜15年目は信金のみ', sj[1].totalRepay, PMT_2500);

    // 落札額・リフォーム費を超える分は手元資金に回る
    const b = familyAllocation({ price: 400, reno: 600, other: 100 }, 600, 358.8, 500);
    near('配分の上限：落札額−保証金まで', b.toPrice, 241.2, 1e-9);
    check('配分の上限：リフォーム費まで／残りは手元', b.toReno === 500 && Math.abs(b.toHand - 358.8) < 1e-9);
  }

  section('親族借入：期限一括');
  {
    const inp = base({ hasFam: true, famAmt: 400, famRate: 1, famYrs: 10, famMethod: 'bullet' });
    near('毎月は利息のみ（400万×1%÷12）', famMonthlyPmt(inp), 3333.33);
    check('元本を返すのは10年目', famBalloonYear(inp) === 10);
    const rows = simulateBullet(400, 1, 10, 12);
    near('1年目の支払は利息12か月分', rows[0].payment, 40000, 0.01);
    near('10年目の支払は利息＋元本400万', rows[9].payment, 4040000, 0.01);
    check('残債は9年目末まで400万、10年目末に 0', rows[8].balance === 400e4 && rows[9].balance === 0 && rows[10].payment === 0);
    const years = simulateYears(inp, () => BANK_RATE, 15);
    near('年次CFの10年目に元本の返済が入る', years[9].cf, (NOI - PMT_1700 - PMT_K600) * 12 - 4040000, 0.05);
  }

  section('入札上限の逆算');
  {
    const t = auctionTerms(1794, 0.2, 0.8);
    check('売却基準価額1,794万 → 保証金358.8万・買受可能価額1,435.2万', t.deposit === 358.8 && t.minBid === 1435.2);
    const inp = base();
    const p = solveMaxPrice(inp, 20, 0, t.deposit, 0);
    check('CFからの上限は 1,736万', p === 1736, `実際 ${p}`);
    const cfAt = (price) => calcStages(inputsAtPrice(inp, price, t.deposit, 0))[0].cf;
    check('上限で落札すると月次CFは最低ライン以上', cfAt(p) >= 0, `CF ${cfAt(p)}`);
    check('上限＋1万では最低ラインを割る', cfAt(p + 1) < 0, `CF ${cfAt(p + 1)}`);
    const p2 = solveMaxPrice(inp, 20, 10000, t.deposit, 0);
    check('最低ライン1万円：上限で CF≥1万円、＋1万で未満',
      cfAt(p2) >= 10000 && cfAt(p2 + 1) < 10000, `上限 ${p2}`);
    check('返済余力がなければ null', solveMaxPrice(base({ eqAmt: 2000 }), 14, 0, t.deposit, 0) === null);

    const o = { depositMan: t.deposit, toPriceMan: 0, minCfYen: 0, minBidMan: t.minBid };
    const single = solveBidLimit(inp, Object.assign({ bankCapMan: 1700 }, o));
    check('融資枠からの上限：単独 2,058万', single.byCap === 2058, `実際 ${single.byCap}`);
    check('家賃20万・公庫600万では CF が先に効く（入札上限1,736万・入札可）',
      single.limit === 1736 && single.binding === 'cf' && single.feasible);
    // 公庫なし・家賃25万なら融資枠が先に効く
    const rich = base({ rentMan: 25, hasEq: false, eqAmt: 0, eqYrs: 0 });
    const s2 = solveBidLimit(rich, Object.assign({ bankCapMan: 1700 }, o));
    const j2 = solveBidLimit(rich, Object.assign({ bankCapMan: 2500 }, o));
    check('融資枠が効く場合：単独 2,058万（融資枠）', s2.limit === 2058 && s2.binding === 'cap', JSON.stringify(s2));
    check('融資枠が効く場合：共同 2,858万（融資枠）', j2.limit === 2858 && j2.binding === 'cap', JSON.stringify(j2));
    // 親族の上乗せ400万（0%・15年）：融資枠の上限は400万増える
    const fam = base({ rentMan: 25, hasEq: false, eqAmt: 0, eqYrs: 0, hasFam: true, famAmt: 400, famYrs: 15 });
    const s3 = solveBidLimit(fam, Object.assign({ bankCapMan: 1700 }, o, { toPriceMan: 400 }));
    check('親族の上乗せ400万：融資枠からの上限は 2,458万', s3.byCap === 2458, JSON.stringify(s3));
    check('親族の上乗せ：CFからの上限では親族への返済を差し引く',
      s3.byCf === Math.floor(358.8 + 400 + calcPv(200000 - 400e4 / 180, BANK_RATE, BANK_YRS) / 10000), JSON.stringify(s3));
    // 買受可能価額を下回る場合は入札不可
    const poor = solveBidLimit(base({ rentMan: 15 }), Object.assign({ bankCapMan: 1700 }, o));
    check('家賃15万では上限が買受可能価額を下回り入札不可', poor.limit !== null && poor.limit < t.minBid && !poor.feasible, JSON.stringify(poor));
  }

  section('感度分析');
  {
    const inp = base();
    near('対象期間（公庫の返済中）の最低CF ＝ 当初10年のCF', minCfInSensPeriod(inp), calcStages(inp)[0].cf, 1e-9);
    const rent = solveRequiredRent(inp);
    check('必要賃料は 22.9万円', rent === 229000, `実際 ${rent}`);
    check('必要賃料で黒字、千円下げると赤字',
      minCfInSensPeriod(base({ rentMan: rent / 10000 })) >= 0 && minCfInSensPeriod(base({ rentMan: (rent - 1000) / 10000 })) < 0);
    const r = solveMaxBankRate(base({ rentMan: 23 }));
    check('家賃23万の許容金利は 3.517%', r.status === 'ok' && r.rate === 3.517, JSON.stringify(r));
    check('許容金利で黒字、+0.001%で赤字',
      minCfInSensPeriod(base({ rentMan: 23, bankRate: r.rate })) >= 0 && minCfInSensPeriod(base({ rentMan: 23, bankRate: r.rate + 0.001 })) < 0, JSON.stringify(r));
    const r20 = solveMaxBankRate(inp);
    check('家賃20万では許容金利が現在の3.375%を下回る', r20.status === 'ok' && r20.rate < BANK_RATE, JSON.stringify(r20));
    check('家賃19万では金利0%でも赤字', solveMaxBankRate(base({ rentMan: 19 })).status === 'none');
    check('借入なしは noLoan', solveMaxBankRate(base({ bankAmt: 0 })).status === 'noLoan');
  }

  section('金利上昇シナリオ');
  {
    const step = scenarioRateForYear(BANK_RATE, { mode: 'step', stepStartYear: 3, stepRise: 1 });
    check('3年目から+1%：2年目3.375%・3年目4.375%', step(2) === 3.375 && step(3) === 4.375 && step(15) === 4.375);
    const ann = scenarioRateForYear(BANK_RATE, { mode: 'annual', annualStartYear: 2, annualRise: 0.25, annualCap: 2 });
    check('毎年+0.25%（上限+2%）：1年目3.375・2年目3.625・9年目以降5.375',
      ann(1) === 3.375 && ann(2) === 3.625 && ann(9) === 5.375 && ann(15) === 5.375, [ann(1), ann(2), ann(9), ann(15)].join('/'));
    const baseRows = simulateLoan(1700, () => BANK_RATE, 15, 15);
    const upRows = simulateLoan(1700, step, 15, 15);
    near('上昇前（1〜2年目）の返済は据え置きと同じ', upRows[1].payment, baseRows[1].payment, 1e-6);
    near('2年目末の残債', baseRows[1].balance, 15198163.58, 0.5);
    near('3年目の返済 ＝ 残債・残り13年・4.375% で再計算した月額×12', upRows[2].payment, calcPmt(baseRows[1].balance, 4.375, 13) * 12, 0.01);
    near('再計算後の月額', upRows[2].payment / 12, 127914.05, 0.01);
    check('金利が上がっても15年で完済', upRows[14].balance === 0);
    near('総返済額の増加', sum(upRows, 'payment') - sum(baseRows, 'payment'), 1158280.61, 1);
    const y0 = simulateYears(base(), () => BANK_RATE, 15);
    const y1 = simulateYears(base(), step, 15);
    near('累積CFの差 ＝ 総返済額の差（公庫は固定のまま）', y0[14].cumCf - y1[14].cumCf, 1158280.61, 1);
  }

  section('回収年数');
  {
    near('毎年100万のCFで250万を回収 → 2.5年', calcPaybackYears(250e4, () => 100e4), 2.5, 1e-9);
    check('CFが出なければ回収不可', calcPaybackYears(250e4, () => -1) === null);
    // 3年目に回収しても、5年目の一括返済で累計が割り込むなら、その後に回復した時点を回収年数とする
    const p = calcPaybackYears(250e4, (y) => y === 5 ? -400e4 : 100e4);
    near('一括返済で累計が割り込む場合は回復後の年数（7.5年）', p, 7.5, 1e-9);
  }

  const failed = results.filter(r => !r.ok);
  const summary = `計算ロジックの検算：${results.length}件中 ${results.length - failed.length}件 合格${failed.length ? `／${failed.length}件 不合格` : ''}`;
  if (isNode) {
    let g = '';
    results.forEach(r => {
      if (r.group !== g) { g = r.group; console.log(`\n[${g}]`); }
      console.log(`  ${r.ok ? 'OK ' : 'NG '} ${r.name}${r.ok ? '' : `  → ${r.detail}`}`);
    });
    console.log(`\n${summary}`);
    process.exit(failed.length ? 1 : 0);
  } else {
    const box = document.createElement('div');
    box.id = 'selftest-result';
    box.style.cssText = 'background:#fff;border:2px solid ' + (failed.length ? '#ef4444' : '#10b981') + ';border-radius:5px;padding:8px 10px;margin-bottom:6px;font-size:0.72rem;';
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let html = `<b>${failed.length ? '❌' : '✅'} ${summary}</b>`;
    let g = '';
    results.forEach(r => {
      if (r.group !== g) { g = r.group; html += `<div style="margin-top:4px;font-weight:700;">${esc(g)}</div>`; }
      html += `<div style="color:${r.ok ? '#065f46' : '#991b1b'}">${r.ok ? '✓' : '✗'} ${esc(r.name)}${r.ok ? '' : ' → ' + esc(r.detail)}</div>`;
    });
    box.innerHTML = html;
    document.body.insertBefore(box, document.body.firstChild);
  }
})();
