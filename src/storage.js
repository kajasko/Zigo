import { MEMBERS, migrateExpense } from "./money.js";
import { FALLBACK_QUOTE } from "./rates.js";

export const STORAGE_KEY = "zigo-finance";
export const GROUP_ID = "domacnost";
export const ZAGREB_ID = "zahreh";

export const ZAGREB_MEMBERS = [1, 2, 3, 4, 5, 6].map((number) => ({
  id: `z${number}`,
  name: `Osoba ${number}`,
}));

export function zagrebGroup() {
  return {
    id: ZAGREB_ID,
    name: "Záhřeb",
    baseCurrency: "EUR",
    members: ZAGREB_MEMBERS,
    expenses: [],
  };
}

function normalizeGroup(group) {
  const baseCurrency = group.baseCurrency === "EUR" ? "EUR" : "CZK";
  return {
    id: group.id,
    name: group.name,
    baseCurrency,
    members: group.members?.length ? group.members : MEMBERS,
    expenses: (group.expenses || []).map(migrateExpense),
  };
}

export function createSeedState(expenses, quote = FALLBACK_QUOTE) {
  return {
    version: 2,
    activeGroupId: GROUP_ID,
    displayCurrency: "CZK",
    displayByGroup: { [GROUP_ID]: "CZK", [ZAGREB_ID]: "EUR" },
    displayRate: {
      rate: quote.rate,
      rateDate: quote.rateDate,
      rateSource: quote.rateSource || "fallback",
    },
    groups: [
      normalizeGroup({
        id: GROUP_ID,
        name: "Jana a Petr",
        baseCurrency: "CZK",
        members: MEMBERS,
        expenses,
      }),
      zagrebGroup(),
    ],
  };
}

export function normalizeState(raw) {
  if (Array.isArray(raw)) return createSeedState(raw);
  if (!raw || !Array.isArray(raw.groups) || raw.groups.length === 0) return null;
  const groups = raw.groups.map(normalizeGroup);
  if (!groups.some((group) => group.id === ZAGREB_ID)) groups.push(zagrebGroup());
  const displayByGroup = { ...(raw.displayByGroup || {}) };
  for (const group of groups) {
    if (displayByGroup[group.id] !== "CZK" && displayByGroup[group.id] !== "EUR") {
      displayByGroup[group.id] = group.id === GROUP_ID
        ? (raw.displayCurrency === "EUR" ? "EUR" : "CZK")
        : group.baseCurrency;
    }
  }
  return {
    version: 2,
    activeGroupId: raw.activeGroupId || raw.groups[0].id,
    displayCurrency: raw.displayCurrency === "EUR" ? "EUR" : "CZK",
    displayByGroup,
    displayRate: raw.displayRate?.rate > 0 ? {
      rate: raw.displayRate.rate,
      rateDate: raw.displayRate.rateDate ?? null,
      rateSource: raw.displayRate.rateSource || "ecb",
    } : { ...FALLBACK_QUOTE },
    groups,
  };
}

export function loadState(storage, seedExpenses) {
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (text) {
      const normalized = normalizeState(JSON.parse(text));
      if (normalized) return normalized;
    }
  } catch {
    // A broken saved blob falls back to the imported ledger.
  }
  return createSeedState(seedExpenses);
}

export function saveState(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function activeGroup(state) {
  return state.groups.find((group) => group.id === state.activeGroupId) || state.groups[0];
}

export function withGroupExpenses(state, expenses) {
  return updateActiveGroup(state, { expenses });
}

export function updateActiveGroup(state, patch) {
  return {
    ...state,
    groups: state.groups.map((group) => (
      group.id === state.activeGroupId ? { ...group, ...patch } : group
    )),
  };
}

export function groupDisplayCurrency(state, group) {
  return state.displayByGroup?.[group.id] || group.baseCurrency || "CZK";
}
