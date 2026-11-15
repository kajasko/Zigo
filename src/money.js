// Shares use the largest-remainder method so they add up to the receipt exactly.
// A group's ledger is either haléře (CZK) or euro cents (EUR). The rate is always
// how many Kč equal 1 EUR. When fractional parts tie, the earlier member gets
// the extra minor unit. Jana is first in the original household ledger.

export const MEMBERS = [
  { id: "jana", name: "Jana" },
  { id: "petr", name: "Petr" },
];

export const CATEGORIES = [
  "Restaurace",
  "Nečekané výdaje",
  "Jídlo a drogerie",
  "Fond na domácnost",
  "Bydlení + služby",
  "Doprava",
  "Dárky",
  "Koníčky",
  "Fond na dovolenou",
  "Vyrovnání",
];

export function otherMember(memberId, members = MEMBERS) {
  const found = members.find((member) => member.id !== memberId);
  if (!found) throw new Error("Chybí druhý člen skupiny.");
  return found;
}

export function toMinor(value) {
  const raw = String(value).trim().replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Neplatná částka: ${value}`);
  }
  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = raw.replace("-", "").split(".");
  const frac = (fraction + "00").slice(0, 2);
  let minor = Number(whole) * 100 + Number(frac);
  if (fraction.length > 2 && fraction[2] >= "5") minor += 1;
  return negative ? -minor : minor;
}

export function fromMinor(minor) {
  if (!Number.isInteger(minor)) throw new Error("Částka v haléřích musí být celé číslo.");
  const negative = minor < 0;
  const absolute = Math.abs(minor);
  const text = `${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
  return Number(text) * (negative ? -1 : 1);
}

export function normalizeRate(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Neplatný kurz.");
  return Math.round(value * 1e6) / 1e6;
}

export function rateParts(rate) {
  const normalized = normalizeRate(rate);
  const text = normalized.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  const [whole, fraction = ""] = text.split(".");
  return {
    rate: normalized,
    rateInt: Number(whole + fraction),
    denom: 10 ** fraction.length,
  };
}

function divRoundHalfUp(numer, denom) {
  const n = BigInt(numer);
  const d = BigInt(denom);
  if (d <= 0n) throw new Error("Neplatné dělení.");
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const rounded = (abs * 2n + d) / (d * 2n);
  return Number(negative ? -rounded : rounded);
}

export function eurCentsToHalere(eurCents, rate) {
  const { rateInt, denom } = rateParts(rate);
  return divRoundHalfUp(BigInt(eurCents) * BigInt(rateInt), denom);
}

export function halereToEurCents(halere, rate) {
  const { rateInt, denom } = rateParts(rate);
  return divRoundHalfUp(BigInt(halere) * BigInt(denom), rateInt);
}

export function largestRemainder(total, weights) {
  if (!Number.isInteger(total) || total < 0) throw new Error("Součet musí být nezáporné celé číslo.");
  if (weights.some((weight) => !Number.isInteger(weight) || weight < 0)) {
    throw new Error("Váhy podílů musí být nezáporná celá čísla.");
  }
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (total === 0 || sum === 0) return weights.map(() => 0);
  const totalInt = BigInt(total);
  const sumInt = BigInt(sum);
  const floors = [];
  const remainders = [];
  for (const weight of weights) {
    const product = totalInt * BigInt(weight);
    floors.push(Number(product / sumInt));
    remainders.push(product % sumInt);
  }
  let left = total - floors.reduce((acc, part) => acc + part, 0);
  if (left < 0) throw new Error("Zaokrouhlení podílů se rozchází.");
  const order = remainders
    .map((remainder, index) => ({ index, remainder }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  const shares = floors.slice();
  for (let step = 0; step < left; step += 1) {
    if (step >= order.length) throw new Error("Zaokrouhlení podílů se rozchází.");
    shares[order[step].index] += 1;
  }
  return shares;
}

export function toBaseMinor(originalMinor, currency, baseCurrency, rate) {
  if (currency === baseCurrency) return originalMinor;
  if (currency === "EUR" && baseCurrency === "CZK") return eurCentsToHalere(originalMinor, rate);
  if (currency === "CZK" && baseCurrency === "EUR") return halereToEurCents(originalMinor, rate);
  throw new Error("Nepodporovaná kombinace měn.");
}

export function expenseBaseMinor(expense) {
  if (expense.amountBase != null) return toMinor(expense.amountBase);
  return toMinor(expense.amountCzk ?? expense.amount);
}

export function sharesMinor(expense) {
  if (expense.shares && expense.shares.jana != null && expense.shares.petr != null) {
    return { jana: expense.shares.jana, petr: expense.shares.petr };
  }
  const total = expenseBaseMinor(expense);
  const jana = toMinor(expense.manualA);
  const petr = total - jana;
  if (jana < 0 || petr < 0) throw new Error(`Podíly výdaje ${expense.id} nedávají součet.`);
  return { jana, petr };
}

export function ledgerShares(expense) {
  if (expense.shares) return { ...expense.shares };
  return sharesMinor(expense);
}

export function itemLineMinor(item) {
  const unit = toMinor(item.unitPrice || 0);
  if (item.mode === "shared") return Math.round(unit * (Number(item.quantity) || 0));
  const counts = item.counts || {};
  return unit * Object.values(counts).reduce((sum, count) => sum + (Number(count) || 0), 0);
}

export function itemSharesOriginal(item, participantIds) {
  const unit = toMinor(item.unitPrice || 0);
  const shares = Object.fromEntries(participantIds.map((id) => [id, 0]));
  if (item.mode === "shared") {
    const people = (item.sharedAmong || []).filter((id) => participantIds.includes(id));
    const total = Math.round(unit * (Number(item.quantity) || 0));
    const parts = largestRemainder(total, people.map(() => 1));
    people.forEach((id, index) => {
      shares[id] += parts[index];
    });
    return shares;
  }
  for (const id of participantIds) shares[id] = unit * (Number(item.counts?.[id]) || 0);
  return shares;
}

export function combineShares(list) {
  const shares = {};
  for (const part of list) {
    for (const [id, minor] of Object.entries(part)) shares[id] = (shares[id] || 0) + minor;
  }
  return shares;
}

export function originalSharesFor(input) {
  const originalMinor = toMinor(input.originalAmount);
  const participantIds = input.participantIds || ["jana", "petr"];
  if (participantIds.length === 0) {
    return { originalMinor, shares: {}, unassigned: originalMinor };
  }
  if (input.split === "manual") {
    const jana = toMinor(input.manualOriginal || 0);
    const shares = { jana, petr: originalMinor - jana };
    return { originalMinor, shares, unassigned: 0 };
  }
  if (input.split === "equal") {
    const parts = largestRemainder(originalMinor, participantIds.map(() => 1));
    const shares = Object.fromEntries(participantIds.map((id, index) => [id, parts[index]]));
    return { originalMinor, shares, unassigned: 0 };
  }
  if (input.split === "exact") {
    const shares = {};
    let assigned = 0;
    for (const id of participantIds) {
      const minor = toMinor(input.exactAmounts?.[id] || 0);
      shares[id] = minor;
      assigned += minor;
    }
    return { originalMinor, shares, unassigned: originalMinor - assigned };
  }
  if (input.split === "items") {
    const shares = combineShares((input.items || []).map((item) => itemSharesOriginal(item, participantIds)));
    for (const id of participantIds) if (shares[id] == null) shares[id] = 0;
    const assigned = Object.values(shares).reduce((sum, minor) => sum + minor, 0);
    return { originalMinor, shares, unassigned: originalMinor - assigned };
  }
  throw new Error("Neznámé rozdělení.");
}

export function projectSharesToBase(originalShares, currency, baseCurrency, rate) {
  const ids = Object.keys(originalShares);
  const weights = ids.map((id) => originalShares[id]);
  const assigned = weights.reduce((sum, minor) => sum + minor, 0);
  const baseMinor = toBaseMinor(assigned, currency, baseCurrency, rate || 1);
  const parts = largestRemainder(baseMinor, weights);
  return {
    baseMinor,
    shares: Object.fromEntries(ids.map((id, index) => [id, parts[index]])),
  };
}

export function suggestTransfers(balances) {
  const debtors = [];
  const creditors = [];
  for (const [id, value] of Object.entries(balances)) {
    if (value < 0) debtors.push({ id, left: -value });
    else if (value > 0) creditors.push({ id, left: value });
  }
  debtors.sort((a, b) => b.left - a.left || (a.id < b.id ? -1 : 1));
  creditors.sort((a, b) => b.left - a.left || (a.id < b.id ? -1 : 1));
  const transfers = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const amount = Math.min(debtors[debtorIndex].left, creditors[creditorIndex].left);
    if (amount > 0) {
      transfers.push({ from: debtors[debtorIndex].id, to: creditors[creditorIndex].id, minor: amount });
    }
    debtors[debtorIndex].left -= amount;
    creditors[creditorIndex].left -= amount;
    if (debtors[debtorIndex].left === 0) debtorIndex += 1;
    if (creditors[creditorIndex].left === 0) creditorIndex += 1;
  }
  return transfers;
}

export function originalSharesMinor(expense) {
  const total = toMinor(expense.originalAmount ?? expense.amount);
  if (expense.split === "manual" && expense.manualAOriginal != null) {
    const jana = toMinor(expense.manualAOriginal);
    return { jana, petr: total - jana };
  }
  if (expense.currency === "EUR" && expense.split === "equal") {
    const [jana, petr] = largestRemainder(total, [1, 1]);
    return { jana, petr };
  }
  const jana = toMinor(expense.manualA);
  return { jana, petr: total - jana };
}

export function memberBalances(expenses, members = MEMBERS) {
  const balances = Object.fromEntries(members.map((member) => [member.id, 0]));
  const ensure = (id) => {
    if (balances[id] == null) balances[id] = 0;
  };
  for (const expense of expenses) {
    const total = expenseBaseMinor(expense);
    if (expense.split === "settlement") {
      const creditor = expense.payee || otherMember(expense.payer, members).id;
      ensure(expense.payer);
      ensure(creditor);
      balances[expense.payer] += total;
      balances[creditor] -= total;
      continue;
    }
    const shares = ledgerShares(expense);
    for (const [id, share] of Object.entries(shares)) {
      ensure(id);
      balances[id] -= share;
    }
    ensure(expense.payer);
    balances[expense.payer] += total;
  }
  return balances;
}

export function expenseTotalMinor(expenses) {
  return expenses
    .filter((expense) => expense.split !== "settlement")
    .reduce((sum, expense) => sum + expenseBaseMinor(expense), 0);
}

export function convertSignedMinor(values, rate) {
  const positives = [];
  const negatives = [];
  values.forEach((value, index) => {
    if (value > 0) positives.push(index);
    else if (value < 0) negatives.push(index);
  });
  const positiveSum = positives.reduce((sum, index) => sum + values[index], 0);
  const positiveCents = halereToEurCents(positiveSum, rate);
  const out = values.map(() => 0);
  const positiveParts = largestRemainder(positiveCents, positives.map((index) => values[index]));
  positives.forEach((index, part) => {
    out[index] = positiveParts[part];
  });
  const negativeParts = largestRemainder(positiveCents, negatives.map((index) => -values[index]));
  negatives.forEach((index, part) => {
    out[index] = -negativeParts[part];
  });
  return out;
}

export function convertSignedBetween(values, fromCurrency, toCurrency, rate) {
  if (fromCurrency === toCurrency) return values.slice();
  const positives = [];
  const negatives = [];
  values.forEach((value, index) => {
    if (value > 0) positives.push(index);
    else if (value < 0) negatives.push(index);
  });
  const positiveSum = positives.reduce((sum, index) => sum + values[index], 0);
  const positiveTarget = toBaseMinor(positiveSum, fromCurrency, toCurrency, rate);
  const out = values.map(() => 0);
  const positiveParts = largestRemainder(positiveTarget, positives.map((index) => values[index]));
  positives.forEach((index, part) => {
    out[index] = positiveParts[part];
  });
  const negativeParts = largestRemainder(positiveTarget, negatives.map((index) => -values[index]));
  negatives.forEach((index, part) => {
    out[index] = -negativeParts[part];
  });
  return out;
}

export function displayLedger(balances, baseCurrency, displayCurrency, rate, members = MEMBERS) {
  const ordered = members.map((member) => balances[member.id] || 0);
  const converted = convertSignedBetween(ordered, baseCurrency, displayCurrency, rate);
  return Object.fromEntries(members.map((member, index) => [member.id, converted[index]]));
}

export function expenseDisplayFrom(expenses, baseCurrency, displayCurrency, rate) {
  const items = expenses.filter((expense) => expense.split !== "settlement");
  const minors = items.map((expense) => expenseBaseMinor(expense));
  if (displayCurrency === baseCurrency) {
    return Object.fromEntries(items.map((expense, index) => [expense.id, minors[index]]));
  }
  const total = minors.reduce((sum, minor) => sum + minor, 0);
  const parts = largestRemainder(toBaseMinor(total, baseCurrency, displayCurrency, rate), minors);
  return Object.fromEntries(items.map((expense, index) => [expense.id, parts[index]]));
}

export function displayBalances(balances, currency, rate, members = MEMBERS) {
  const ordered = members.map((member) => balances[member.id] || 0);
  if (currency === "CZK") {
    return Object.fromEntries(members.map((member, index) => [member.id, ordered[index]]));
  }
  const converted = convertSignedMinor(ordered, rate);
  return Object.fromEntries(members.map((member, index) => [member.id, converted[index]]));
}

export function expenseDisplayMinors(expenses, currency, rate) {
  const items = expenses.filter((expense) => expense.split !== "settlement");
  const minors = items.map((expense) => toMinor(expense.amountCzk ?? expense.amount));
  if (currency === "CZK") {
    return Object.fromEntries(items.map((expense, index) => [expense.id, minors[index]]));
  }
  const total = minors.reduce((sum, minor) => sum + minor, 0);
  const parts = largestRemainder(halereToEurCents(total, rate), minors);
  return Object.fromEntries(items.map((expense, index) => [expense.id, parts[index]]));
}

export function migrateExpense(raw) {
  const withCurrency = raw.currency === "CZK" || raw.currency === "EUR"
    ? {
      ...raw,
      originalAmount: raw.originalAmount ?? raw.amount,
      amountCzk: raw.amountCzk != null
        ? raw.amountCzk
        : (raw.currency === "CZK" || raw.baseCurrency === "CZK" ? raw.amount : undefined),
      rate: raw.rate ?? (raw.currency === "CZK" ? 1 : raw.rate),
      rateSource: raw.rateSource ?? (raw.currency === "CZK" ? "legacy" : "ecb"),
      rateDate: raw.rateDate ?? null,
    }
    : {
      ...raw,
      currency: "CZK",
      rate: 1,
      rateSource: "legacy",
      rateDate: null,
      originalAmount: raw.amount,
      amountCzk: raw.amount,
    };
  const baseCurrency = withCurrency.baseCurrency || "CZK";
  const amountBase = withCurrency.amountBase ?? (baseCurrency === "CZK" ? withCurrency.amountCzk : withCurrency.amount);
  let shares = withCurrency.shares;
  if (!shares && withCurrency.split !== "settlement" && withCurrency.manualA != null && baseCurrency === "CZK") {
    const total = toMinor(amountBase);
    const jana = toMinor(withCurrency.manualA);
    shares = { jana, petr: total - jana };
  }
  return {
    ...withCurrency,
    amount: withCurrency.amount,
    baseCurrency,
    amountBase,
    shares,
  };
}

export function buildExpense(input) {
  const currency = input.currency === "EUR" ? "EUR" : "CZK";
  const baseCurrency = input.baseCurrency || "CZK";
  const originalMinor = toMinor(input.originalAmount);
  if (originalMinor <= 0) throw new Error("Částka musí být větší než nula.");
  const sameCurrency = currency === baseCurrency;
  const rate = sameCurrency ? 1 : normalizeRate(input.rate);
  const draft = originalSharesFor({ ...input, originalAmount: fromMinor(originalMinor) });
  if (draft.unassigned !== 0) {
    throw new Error("Součet podílů se musí rovnat účtence.");
  }
  if (Object.values(draft.shares).some((minor) => minor < 0)) {
    throw new Error("Podíl nemůže být záporný.");
  }
  const projected = projectSharesToBase(draft.shares, currency, baseCurrency, rate);
  const fullBase = toBaseMinor(originalMinor, currency, baseCurrency, rate);
  if (projected.baseMinor !== fullBase) throw new Error("Přepočet podílů nesedí s účtenkou.");
  const amountBase = fromMinor(fullBase);
  const amountCzk = baseCurrency === "CZK"
    ? amountBase
    : currency === "CZK"
      ? fromMinor(originalMinor)
      : undefined;
  const expense = {
    id: input.id,
    title: input.title.trim(),
    amount: baseCurrency === "CZK" ? amountCzk : amountBase,
    amountCzk,
    amountBase,
    baseCurrency,
    originalAmount: fromMinor(originalMinor),
    originalShares: draft.shares,
    currency,
    rate,
    rateSource: sameCurrency ? (currency === "CZK" ? "czk" : "base") : input.rateSource,
    rateDate: sameCurrency ? null : input.rateDate ?? null,
    payer: input.payer,
    participantIds: input.participantIds || Object.keys(draft.shares),
    split: input.split,
    shares: projected.shares,
    date: input.date,
    category: input.category,
  };
  if (draft.shares.jana != null && draft.shares.petr != null && Object.keys(draft.shares).length === 2) {
    expense.manualA = fromMinor(projected.shares.jana);
    expense.manualAOriginal = fromMinor(draft.shares.jana);
  }
  if (input.split === "items") expense.items = input.items;
  if (input.split === "exact") expense.exactAmounts = input.exactAmounts;
  return expense;
}

export function buildSettlement(input) {
  const currency = input.currency === "EUR" ? "EUR" : "CZK";
  const baseCurrency = input.baseCurrency || "CZK";
  const sameCurrency = currency === baseCurrency;
  const rate = sameCurrency ? 1 : normalizeRate(input.rate);
  const originalMinor = toMinor(input.originalAmount);
  if (originalMinor <= 0) throw new Error("Částka vyrovnání musí být větší než nula.");
  const debtMinor = input.debtMinor ?? input.debtHalere;
  const baseMinor = input.settlementMode === "full-debt"
    ? debtMinor
    : toBaseMinor(originalMinor, currency, baseCurrency, rate);
  if (!Number.isInteger(baseMinor) || baseMinor <= 0) throw new Error("Neplatná zaúčtovaná částka.");
  const amountBase = fromMinor(baseMinor);
  const amountCzk = baseCurrency === "CZK"
    ? amountBase
    : currency === "CZK"
      ? fromMinor(originalMinor)
      : fromMinor(eurCentsToHalere(baseCurrency === "EUR" ? baseMinor : originalMinor, rate));
  return {
    id: input.id,
    title: "Vyrovnání",
    amount: baseCurrency === "CZK" ? amountCzk : amountBase,
    amountCzk,
    amountBase,
    baseCurrency,
    originalAmount: fromMinor(originalMinor),
    currency,
    rate,
    rateSource: sameCurrency ? (currency === "CZK" ? "czk" : "base") : input.rateSource,
    rateDate: sameCurrency ? null : input.rateDate ?? null,
    payer: input.payer,
    payee: input.payee || null,
    split: "settlement",
    settlementMode: input.settlementMode,
    manualA: 0,
    date: input.date,
    category: "Vyrovnání",
  };
}

export function impliedCzkMinor(currency, originalMinor, rate) {
  if (currency !== "EUR") return originalMinor;
  return eurCentsToHalere(originalMinor, rate);
}

export function formatMoney(minor, currency) {
  const negative = minor < 0;
  const absolute = Math.abs(minor);
  const grouped = String(Math.floor(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  const text = `${grouped},${String(absolute % 100).padStart(2, "0")}`;
  return `${negative ? "−" : ""}${text} ${currency === "EUR" ? "EUR" : "Kč"}`;
}

export function formatRate(rate) {
  const normalized = normalizeRate(rate);
  let text = normalized.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  const fraction = text.split(".")[1] || "";
  if (fraction.length < 3) text = normalized.toFixed(3);
  return text.replace(".", ",");
}

export function formatDate(iso) {
  if (!iso) return "";
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}.${month}.${year}`;
}

export function parseAmount(input) {
  let text = String(input).trim().replace(/\s/g, "").replace(",", ".");
  if (text.endsWith(".")) text = text.slice(0, -1);
  if (!text || !/^\d+(\.\d{0,2})?$/.test(text)) return null;
  return Number(text);
}

export function parseRate(input) {
  const text = String(input).trim().replace(/\s/g, "").replace(",", ".");
  if (!text) return null;
  if (!/^\d+(\.\d{0,6})?$/.test(text)) return null;
  const value = Number(text);
  return value > 0 ? value : null;
}

export function expenseCountLabel(count) {
  const mod = count % 100;
  const last = count % 10;
  if (last === 1 && mod !== 11) return `${count} výdaj`;
  if (last >= 2 && last <= 4 && (mod < 12 || mod > 14)) return `${count} výdaje`;
  return `${count} výdajů`;
}
