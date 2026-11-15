import assert from "node:assert/strict";
import test from "node:test";
import { importedShared } from "./importedTransactions.js";
import {
  buildExpense,
  buildSettlement,
  displayBalances,
  expenseDisplayFrom,
  expenseDisplayMinors,
  expenseTotalMinor,
  fromMinor,
  halereToEurCents,
  largestRemainder,
  memberBalances,
  migrateExpense,
  sharesMinor,
  suggestTransfers,
  toBaseMinor,
  toMinor,
} from "./money.js";
import { rateLabel, resolveEurCzkQuote } from "./rates.js";
import { createSeedState, loadState, normalizeState } from "./storage.js";

test("legacy expenses stay CZK at rate 1 and keep their amounts", () => {
  const legacy = {
    id: 1004,
    title: "Albert - oběd",
    amount: 75.8,
    payer: "jana",
    split: "equal",
    manualA: 37.9,
    date: "2025-07-03",
    category: "Jídlo a drogerie",
  };
  const once = migrateExpense(legacy);
  assert.equal(once.amount, 75.8);
  assert.equal(once.amountCzk, 75.8);
  assert.equal(once.originalAmount, 75.8);
  assert.equal(once.manualA, 37.9);
  assert.equal(once.currency, "CZK");
  assert.equal(once.rate, 1);
  assert.equal(once.rateSource, "legacy");
  const twice = migrateExpense(once);
  assert.equal(twice.amount, 75.8);
  assert.equal(twice.rate, 1);
  assert.equal(twice.currency, "CZK");
});

test("imported ledger still settles to the historical haléř balances", () => {
  const expenses = importedShared.map(migrateExpense);
  assert.equal(expenses[0].amount, 309);
  assert.equal(expenses[0].currency, "CZK");
  let running = { jana: 0, petr: 0 };
  for (const expense of expenses) {
    if (expense.split === "settlement") {
      const before = running.petr;
      running = memberBalances(expenses.slice(0, expenses.indexOf(expense) + 1));
      assert.equal(running.jana, 0);
      assert.equal(running.petr, 0);
      assert.equal(Math.abs(before), toMinor(expense.amount));
      continue;
    }
    running = memberBalances(expenses.slice(0, expenses.indexOf(expense) + 1));
  }
  const end = memberBalances(expenses);
  assert.equal(end.jana, 28125);
  assert.equal(end.petr, -28125);
  assert.equal(end.jana + end.petr, 0);
});

test("largest remainder gives the extra minor unit to Jana and sums exactly", () => {
  assert.deepEqual(largestRemainder(1001, [1, 1]), [501, 500]);
  assert.deepEqual(largestRemainder(100, [1, 1, 1]), [34, 33, 33]);
  assert.equal(largestRemainder(5, [1, 1]).reduce((sum, part) => sum + part, 0), 5);
});

test("CZK and EUR expenses share one CZK ledger", () => {
  const czk = buildExpense({
    id: 1,
    title: "Oběd",
    originalAmount: 100,
    currency: "CZK",
    payer: "jana",
    split: "equal",
    category: "Jídlo a drogerie",
    date: "2026-11-15",
  });
  const eur = buildExpense({
    id: 2,
    title: "Večeře",
    originalAmount: 10,
    currency: "EUR",
    rate: 25,
    rateSource: "ecb",
    rateDate: "2026-11-13",
    payer: "petr",
    split: "equal",
    category: "Jídlo a drogerie",
    date: "2026-11-15",
  });
  assert.equal(czk.amount, 100);
  assert.equal(czk.rate, 1);
  assert.equal(eur.originalAmount, 10);
  assert.equal(eur.amountCzk, 250);
  assert.equal(eur.amount, 250);
  const shares = sharesMinor(eur);
  assert.equal(shares.jana + shares.petr, toMinor(eur.amountCzk));
  const balances = memberBalances([czk, eur]);
  assert.equal(balances.jana, -7500);
  assert.equal(balances.petr, 7500);
});

test("manual EUR shares convert into CZK shares that sum to the stored amount", () => {
  const expense = buildExpense({
    id: 3,
    title: "Taxík",
    originalAmount: 10,
    currency: "EUR",
    rate: 24.424,
    rateSource: "manual",
    rateDate: null,
    payer: "jana",
    split: "manual",
    manualOriginal: 3,
    category: "Doprava",
    date: "2026-11-15",
  });
  assert.equal(expense.manualAOriginal, 3);
  const shares = sharesMinor(expense);
  assert.equal(shares.jana + shares.petr, toMinor(expense.amountCzk));
  assert.equal(toMinor(expense.amount), toMinor(expense.amountCzk));
});

test("a later display rate does not change a saved expense or settlement", () => {
  const expense = buildExpense({
    id: 4,
    title: "Lístky",
    originalAmount: 20,
    currency: "EUR",
    rate: 24.424,
    rateSource: "ecb",
    rateDate: "2026-11-13",
    payer: "petr",
    split: "equal",
    category: "Koníčky",
    date: "2026-11-15",
  });
  const frozen = JSON.stringify(expense);
  const shown = expenseDisplayMinors([expense], "EUR", 30);
  assert.equal(JSON.stringify(expense), frozen);
  assert.notEqual(shown[expense.id], toMinor(expense.originalAmount));

  const settlement = buildSettlement({
    id: 5,
    payer: "petr",
    currency: "EUR",
    originalAmount: fromMinor(halereToEurCents(28125, 24.424)),
    rate: 24.424,
    rateSource: "ecb",
    rateDate: "2026-11-13",
    debtHalere: 28125,
    settlementMode: "full-debt",
    date: "2026-11-15",
  });
  const saved = JSON.stringify(settlement);
  displayBalances({ jana: 28125, petr: -28125 }, "EUR", 26);
  assert.equal(JSON.stringify(settlement), saved);
  assert.equal(settlement.amountCzk, 281.25);
  assert.equal(settlement.rate, 24.424);
  assert.equal(settlement.currency, "EUR");
});

test("full-debt settlement clears the imported balance exactly", () => {
  const expenses = importedShared.map(migrateExpense);
  const before = memberBalances(expenses);
  const settlement = buildSettlement({
    id: 9000,
    payer: "petr",
    currency: "EUR",
    originalAmount: 11.52,
    rate: 24.424,
    rateSource: "ecb",
    rateDate: "2026-11-13",
    debtHalere: -before.petr,
    settlementMode: "full-debt",
    date: "2026-11-15",
  });
  const after = memberBalances([...expenses, settlement]);
  assert.equal(after.jana, 0);
  assert.equal(after.petr, 0);
  assert.equal(settlement.amount, 281.25);
});

test("EUR display parts sum to one converted total", () => {
  const expenses = [
    buildExpense({
      id: 1, title: "A", originalAmount: 10, currency: "CZK", payer: "jana", split: "equal", category: "Dárky", date: "2026-11-15",
    }),
    buildExpense({
      id: 2, title: "B", originalAmount: 1, currency: "EUR", rate: 24.424, rateSource: "ecb", rateDate: "2026-11-13", payer: "petr", split: "equal", category: "Dárky", date: "2026-11-15",
    }),
  ];
  const parts = expenseDisplayMinors(expenses, "EUR", 24.424);
  const shown = Object.values(parts).reduce((sum, part) => sum + part, 0);
  const total = halereToEurCents(expenseTotalMinor(expenses), 24.424);
  assert.equal(shown, total);
  const balances = displayBalances(memberBalances(expenses), "EUR", 24.424);
  assert.equal(balances.jana + balances.petr, 0);
});

test("saved legacy state migrates without rewriting the amount", () => {
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
  };
  storage.setItem("zigo-finance", JSON.stringify([{
    id: 7,
    title: "Nájem",
    amount: 2500,
    payer: "petr",
    split: "equal",
    manualA: 1250,
    date: "2025-07-03",
    category: "Bydlení + služby",
  }]));
  const loaded = loadState(storage, importedShared);
  assert.equal(loaded.groups[0].expenses[0].amount, 2500);
  assert.equal(loaded.groups[0].expenses[0].currency, "CZK");
  assert.equal(loaded.groups[0].expenses[0].rate, 1);
  assert.equal(loaded.displayCurrency, "CZK");
  assert.equal(loaded.groups.find((group) => group.id === "zahreh").baseCurrency, "EUR");
  assert.equal(loaded.groups[0].baseCurrency, "CZK");
  const seeded = createSeedState(importedShared);
  assert.equal(seeded.groups[0].expenses.length, importedShared.length);
  assert.equal(normalizeState(seeded).groups[0].expenses[0].amount, importedShared[0].amount);
});

test("rate labels name Frankfurter and do not pretend to be Revolut", () => {
  assert.equal(rateLabel("ecb", "2026-11-13"), "Orientační kurz ECB (Frankfurter), 13.11.2026");
  assert.equal(rateLabel("manual", "2026-11-13"), "Ručně upraveno");
  assert.match(rateLabel("fallback", "2026-11-13"), /Není to kurz Revolutu/);
  assert.equal(rateLabel("legacy", null), "Původní výdaj v Kč, kurz 1");
});

test("six-person euro dinner keeps counts, meals and a shared item exact", () => {
  const people = ["z1", "z2", "z3", "z4", "z5", "z6"];
  const expense = buildExpense({
    id: 50,
    title: "Večeře",
    originalAmount: 47.5,
    currency: "EUR",
    baseCurrency: "EUR",
    payer: "z1",
    participantIds: people,
    split: "items",
    category: "Restaurace",
    date: "2026-11-15",
    items: [
      { name: "Pivo", unitPrice: 4, mode: "counts", counts: { z1: 2, z2: 3, z3: 0, z4: 0, z5: 0, z6: 0 } },
      { name: "Hlavní chod", unitPrice: 12.5, mode: "counts", counts: { z4: 1 } },
      { name: "Těstoviny", unitPrice: 9, mode: "counts", counts: { z5: 1 } },
      { name: "Voda", unitPrice: 6, mode: "shared", quantity: 1, sharedAmong: ["z1", "z2", "z6"] },
    ],
  });
  assert.equal(expense.amountBase, 47.5);
  assert.equal(expense.rate, 1);
  assert.equal(expense.rateSource, "base");
  const shares = expense.shares;
  assert.equal(Object.values(shares).reduce((sum, minor) => sum + minor, 0), 4750);
  assert.equal(shares.z1, 1000);
  assert.equal(shares.z2, 1400);
  assert.equal(shares.z3, 0);
  assert.equal(shares.z4, 1250);
  assert.equal(shares.z5, 900);
  assert.equal(shares.z6, 200);
  const balances = memberBalances([expense], people.map((id) => ({ id, name: id })));
  assert.equal(balances.z1, 3750);
  assert.equal(balances.z2, -1400);
  assert.equal(Object.values(balances).reduce((sum, minor) => sum + minor, 0), 0);
  const frozen = JSON.stringify(expense);
  expenseDisplayFrom([expense], "EUR", "CZK", 30);
  assert.equal(JSON.stringify(expense), frozen);
});

test("payer outside the split is credited the whole receipt", () => {
  const expense = buildExpense({
    id: 51,
    title: "Taxík",
    originalAmount: 30,
    currency: "EUR",
    baseCurrency: "EUR",
    payer: "z1",
    participantIds: ["z2", "z3"],
    split: "equal",
    category: "Doprava",
    date: "2026-11-15",
  });
  assert.equal(expense.shares.z1, undefined);
  assert.equal(expense.shares.z2 + expense.shares.z3, 3000);
  const balances = memberBalances([expense], ["z1", "z2", "z3"].map((id) => ({ id, name: id })));
  assert.equal(balances.z1, 3000);
  assert.equal(balances.z2, -1500);
  assert.equal(balances.z3, -1500);
});

test("exact shares must match and a crown receipt in an euro group stores the euro conversion", () => {
  assert.throws(() => buildExpense({
    id: 52,
    title: "Špatně",
    originalAmount: 10,
    currency: "EUR",
    baseCurrency: "EUR",
    payer: "z1",
    participantIds: ["z1", "z2"],
    split: "exact",
    exactAmounts: { z1: 3, z2: 3 },
    category: "Ostatní",
    date: "2026-11-15",
  }));
  const crowns = buildExpense({
    id: 53,
    title: "Lékárna",
    originalAmount: 245,
    currency: "CZK",
    baseCurrency: "EUR",
    rate: 24.5,
    rateSource: "ecb",
    rateDate: "2026-11-13",
    payer: "z2",
    participantIds: ["z1", "z2"],
    split: "equal",
    category: "Ostatní",
    date: "2026-11-15",
  });
  assert.equal(crowns.originalAmount, 245);
  assert.equal(crowns.currency, "CZK");
  assert.equal(crowns.amountBase, 10);
  assert.equal(crowns.rate, 24.5);
  assert.equal(crowns.shares.z1 + crowns.shares.z2, 1000);
  const saved = JSON.stringify(crowns);
  toBaseMinor(toMinor(245), "CZK", "EUR", 30);
  assert.equal(JSON.stringify(crowns), saved);
});

test("minimum transfers settle a six-person euro group without an automatic payment", () => {
  const members = ["z1", "z2", "z3", "z4", "z5", "z6"].map((id) => ({ id, name: id }));
  const dinner = buildExpense({
    id: 60,
    title: "Večeře",
    originalAmount: 60,
    currency: "EUR",
    baseCurrency: "EUR",
    payer: "z1",
    participantIds: members.map((member) => member.id),
    split: "equal",
    category: "Restaurace",
    date: "2026-11-15",
  });
  const balances = memberBalances([dinner], members);
  const plan = suggestTransfers(balances);
  assert.equal(plan.length, 5);
  assert.equal(plan.reduce((sum, transfer) => sum + transfer.minor, 0), 5000);
  const settlement = buildSettlement({
    id: 61,
    payer: plan[0].from,
    payee: plan[0].to,
    currency: "EUR",
    baseCurrency: "EUR",
    originalAmount: fromMinor(plan[0].minor),
    debtMinor: plan[0].minor,
    settlementMode: "full-debt",
    date: "2026-11-15",
  });
  const after = memberBalances([dinner, settlement], members);
  const remaining = suggestTransfers(after);
  assert.equal(remaining.length, 4);
  assert.equal(settlement.amountBase, fromMinor(plan[0].minor));
  assert.equal(settlement.rate, 1);
});

test("offline rate falls back to the cache and then to the ECB snapshot", async () => {
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
  };
  const failed = await resolveEurCzkQuote({ fetchImpl: async () => { throw new Error("offline"); }, storage });
  assert.equal(failed.rateSource, "fallback");
  assert.equal(failed.rate, 24.424);
  storage.setItem("zigo-finance-rate", JSON.stringify({ rate: 24.5, rateDate: "2026-11-01" }));
  const cached = await resolveEurCzkQuote({ fetchImpl: async () => { throw new Error("offline"); }, storage });
  assert.equal(cached.rateSource, "cache");
  assert.equal(cached.rate, 24.5);
  const live = await resolveEurCzkQuote({
    storage,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ amount: 1, base: "EUR", date: "2026-11-13", rates: { CZK: 24.424 } }),
    }),
  });
  assert.equal(live.rateSource, "ecb");
  assert.equal(live.rateDate, "2026-11-13");
  assert.equal(JSON.parse(storage.getItem("zigo-finance-rate")).rate, 24.424);
});
