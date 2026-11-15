import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChevronLeft, Plus, Search } from "lucide-react";
import { importedShared } from "./importedTransactions.js";
import {
  CATEGORIES,
  buildExpense,
  buildSettlement,
  displayLedger,
  expenseBaseMinor,
  expenseCountLabel,
  expenseDisplayFrom,
  formatDate,
  formatMoney,
  formatRate,
  memberBalances,
  originalSharesFor,
  parseAmount,
  parseRate,
  projectSharesToBase,
  suggestTransfers,
  toMinor,
  normalizeRate,
} from "./money.js";
import { rateLabel, resolveEurCzkQuote } from "./rates.js";
import {
  activeGroup,
  groupDisplayCurrency,
  loadState,
  saveState,
  updateActiveGroup,
  withGroupExpenses,
} from "./storage.js";
import "./styles.css";

function memberName(members, id) {
  return members.find((member) => member.id === id)?.name || id;
}

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function nextId(expenses) {
  return expenses.reduce((max, expense) => Math.max(max, Number(expense.id) || 0), 1000) + 1;
}

function minorToInput(minor) {
  const absolute = Math.abs(minor);
  return `${Math.floor(absolute / 100)},${String(absolute % 100).padStart(2, "0")}`;
}

function CurrencyToggle({ value, onChange, testId, label }) {
  return (
    <div className="seg" role="group" aria-label={label} data-testid={testId}>
      {["CZK", "EUR"].map((currency) => (
        <button
          key={currency}
          type="button"
          className={value === currency ? "active" : ""}
          aria-pressed={value === currency}
          onClick={() => onChange(currency)}
        >
          {currency === "CZK" ? "Kč" : "EUR"}
        </button>
      ))}
    </div>
  );
}

function rateMetaFromInput(quote, rate, touched) {
  if (!rate) return { rate: null, rateSource: "manual", rateDate: null };
  const sameAsQuote = quote && normalizeRate(rate) === normalizeRate(quote.rate);
  if (sameAsQuote && !touched) return { rate: quote.rate, rateSource: quote.rateSource, rateDate: quote.rateDate };
  if (touched && !sameAsQuote) return { rate, rateSource: "manual", rateDate: null };
  if (quote && sameAsQuote) return { rate: quote.rate, rateSource: quote.rateSource, rateDate: quote.rateDate };
  return { rate, rateSource: "manual", rateDate: null };
}

function currencyName(currency) {
  return currency === "EUR" ? "eurech" : "korunách";
}

function App() {
  const [state, setState] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteReady, setQuoteReady] = useState(false);
  const [page, setPage] = useState({ name: "overview" });

  useEffect(() => {
    setState(loadState(localStorage, importedShared));
    let live = true;
    resolveEurCzkQuote({ storage: localStorage }).then((next) => {
      if (!live) return;
      setQuote(next);
      setQuoteReady(true);
      setState((prev) => {
        if (!prev || prev.displayRate?.rateSource === "manual") return prev;
        const same = prev.displayRate
          && prev.displayRate.rate === next.rate
          && prev.displayRate.rateDate === next.rateDate
          && prev.displayRate.rateSource === next.rateSource;
        if (same) return prev;
        return {
          ...prev,
          displayRate: { rate: next.rate, rateDate: next.rateDate, rateSource: next.rateSource },
        };
      });
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (state) saveState(localStorage, state);
  }, [state]);

  if (!state) {
    return <div className="shell"><div className="phone"><p className="loading">Načítám Zigo…</p></div></div>;
  }

  const group = activeGroup(state);
  const balances = memberBalances(group.expenses, group.members);
  const openExpense = page.name === "detail"
    ? group.expenses.find((expense) => expense.id === page.id)
    : null;

  return (
    <div className="shell">
      <div className="phone">
        {page.name === "overview" && (
          <Overview
            state={state}
            group={group}
            balances={balances}
            quoteReady={quoteReady}
            onGroup={(id) => setState((prev) => ({ ...prev, activeGroupId: id }))}
            onCurrency={(currency) => setState((prev) => ({
              ...prev,
              displayCurrency: currency,
              displayByGroup: { ...prev.displayByGroup, [prev.activeGroupId]: currency },
            }))}
            onManualRate={(rate) => setState((prev) => ({
              ...prev,
              displayRate: { rate: normalizeRate(rate), rateDate: null, rateSource: "manual" },
            }))}
            onRestoreRate={() => {
              if (!quote) return;
              setState((prev) => ({
                ...prev,
                displayRate: { rate: quote.rate, rateDate: quote.rateDate, rateSource: quote.rateSource },
              }));
            }}
            onOpen={(id) => setPage({ name: "detail", id })}
            onAdd={() => setPage({ name: "add" })}
            onSettle={(transfer) => setPage({ name: "settle", transfer })}
            onSettings={() => setPage({ name: "settings" })}
          />
        )}
        {page.name === "detail" && openExpense && (
          <Detail expense={openExpense} members={group.members} onBack={() => setPage({ name: "overview" })} />
        )}
        {page.name === "add" && (
          <AddExpense
            group={group}
            quote={quote}
            quoteReady={quoteReady}
            onCancel={() => setPage({ name: "overview" })}
            onSave={(expense) => {
              setState((prev) => withGroupExpenses(prev, [...activeGroup(prev).expenses, expense]));
              setPage({ name: "detail", id: expense.id });
            }}
          />
        )}
        {page.name === "settle" && (
          <Settle
            group={group}
            balances={balances}
            transfer={page.transfer}
            displayRate={state.displayRate}
            quoteReady={quoteReady}
            onCancel={() => setPage({ name: "overview" })}
            onSave={(settlement) => {
              setState((prev) => withGroupExpenses(prev, [...activeGroup(prev).expenses, settlement]));
              setPage({ name: "detail", id: settlement.id });
            }}
          />
        )}
        {page.name === "settings" && (
          <GroupSettings
            group={group}
            onBack={() => setPage({ name: "overview" })}
            onChange={(patch) => setState((prev) => {
              const next = updateActiveGroup(prev, patch);
              if (patch.baseCurrency) {
                return {
                  ...next,
                  displayByGroup: { ...next.displayByGroup, [prev.activeGroupId]: patch.baseCurrency },
                };
              }
              return next;
            })}
          />
        )}
      </div>
    </div>
  );
}

function Overview({ state, group, balances, quoteReady, onGroup, onCurrency, onManualRate, onRestoreRate, onOpen, onAdd, onSettle, onSettings }) {
  const [query, setQuery] = useState("");
  const [editingRate, setEditingRate] = useState(false);
  const [rateDraft, setRateDraft] = useState(formatRate(state.displayRate.rate));
  const currency = groupDisplayCurrency(state, group);
  const rate = state.displayRate.rate;
  const shownBalances = displayLedger(balances, group.baseCurrency, currency, rate, group.members);
  const totalMinor = group.expenses.filter((expense) => expense.split !== "settlement").reduce((sum, expense) => sum + expenseBaseMinor(expense), 0);
  const shownTotal = currency === group.baseCurrency ? totalMinor : expenseDisplayFrom(group.expenses, group.baseCurrency, currency, rate);
  const totalShown = currency === group.baseCurrency
    ? totalMinor
    : Object.values(shownTotal).reduce((sum, minor) => sum + minor, 0);
  const rowMinors = expenseDisplayFrom(group.expenses, group.baseCurrency, currency, rate);
  const transfers = suggestTransfers(balances);
  const label = !quoteReady && state.displayRate.rateSource !== "manual"
    ? "Načítám orientační kurz…"
    : rateLabel(state.displayRate.rateSource, state.displayRate.rateDate);
  const expenseOnly = group.expenses.filter((expense) => expense.split !== "settlement");
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("cs");
    return [...group.expenses]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .filter((expense) => !needle || `${expense.title} ${expense.category}`.toLocaleLowerCase("cs").includes(needle));
  }, [group.expenses, query]);

  return (
    <>
      <header className="topbar">
        <div className="wordmark"><i>◒</i> Zigo</div>
        <button type="button" className="link" onClick={onSettings}>Skupina</button>
      </header>
      <main className="screen">
        <div className="groups" role="tablist" aria-label="Skupiny">
          {state.groups.map((item) => (
            <button key={item.id} type="button" className={item.id === group.id ? "active" : ""} onClick={() => onGroup(item.id)}>
              {item.name}
            </button>
          ))}
        </div>
        <section className="heading">
          <p className="eyebrow">Účetnictví v {currencyName(group.baseCurrency)}</p>
          <h1>{group.name}</h1>
          <p className="lede">{expenseOnly.length ? expenseCountLabel(expenseOnly.length) : "Zatím tu není žádný výdaj."} Jména lidí upravíš ve skupině.</p>
        </section>
        <div className="overview-switch">
          <span>Zobrazit v</span>
          <CurrencyToggle value={currency} onChange={onCurrency} testId="overview-currency" label="Měna přehledu" />
        </div>
        <section className="rate-box" data-testid="overview-rate">
          <p className="rate-equation">1 EUR = <b>{formatRate(rate)} Kč</b></p>
          {editingRate ? (
            <div className="rate-edit">
              <input aria-label="Kurz pro zobrazení" inputMode="decimal" value={rateDraft} onChange={(event) => setRateDraft(event.target.value)} />
              <button type="button" onClick={() => { const parsed = parseRate(rateDraft); if (parsed) { onManualRate(parsed); setEditingRate(false); } }}>Hotovo</button>
              <button type="button" onClick={() => { onRestoreRate(); setEditingRate(false); }}>Obnovit z ECB</button>
            </div>
          ) : (
            <button type="button" className="text-button" onClick={() => { setRateDraft(formatRate(rate)); setEditingRate(true); }}>Upravit kurz zobrazení</button>
          )}
          <small data-testid="overview-rate-source">{label}</small>
          <small className="quiet">Jeden kurz pro celé zobrazení. Uložené výdaje ani dluhy se tím nemění. Návrhy vyrovnání se samy neoznačí za zaplacené.</small>
        </section>
        <section className="stats">
          <div>
            <span>Celkové výdaje</span>
            <b data-testid="expense-total">{formatMoney(totalShown, currency)}</b>
          </div>
        </section>
        <div className="share-list">
          {group.members.map((member) => {
            const value = shownBalances[member.id] || 0;
            const word = value > 0 ? "má dostat" : value < 0 ? "dluží" : "vyrovnáno";
            return (
              <div key={member.id}>
                <span>{member.name} {word}</span>
                <b>{formatMoney(Math.abs(value), currency)}</b>
              </div>
            );
          })}
        </div>
        <section className="suggest">
          <p className="eyebrow">Návrh vyrovnání</p>
          <h2>{transfers.length ? "Nejmenší počet plateb" : "Jste vyrovnaní."}</h2>
          <p className="note">Penězmi to neposílá. Nejdřív zaplať, třeba přes Revolut, a tady pak potvrď jen tu platbu, která opravdu odešla.</p>
          {transfers.map((transfer) => {
            const shown = currency === group.baseCurrency
              ? transfer.minor
              : displayLedger(
                { [transfer.from]: -transfer.minor, [transfer.to]: transfer.minor },
                group.baseCurrency,
                currency,
                rate,
                [{ id: transfer.from }, { id: transfer.to }],
              )[transfer.to];
            return (
              <div className="transfer" key={`${transfer.from}-${transfer.to}-${transfer.minor}`}>
                <b>{memberName(group.members, transfer.from)} zaplatí {memberName(group.members, transfer.to)}</b>
                <strong data-testid="settlement-suggestion">{formatMoney(shown, currency)}</strong>
                <button type="button" className="big-cta" onClick={() => onSettle(transfer)}>Zapsat vyrovnání</button>
              </div>
            );
          })}
        </section>
        <label className="searchbox">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat název nebo kategorii" />
        </label>
        <div className="rows">
          {visible.map((expense) => (
            <ExpenseRow key={expense.id} expense={expense} members={group.members} currency={currency} baseCurrency={group.baseCurrency} displayMinor={rowMinors[expense.id]} onOpen={() => onOpen(expense.id)} />
          ))}
          {visible.length === 0 && <p className="empty">Nic tu není.</p>}
        </div>
      </main>
      <div className="bottombar">
        <button type="button" className="big-cta" onClick={onAdd}><Plus size={18} /> Přidat výdaj</button>
      </div>
    </>
  );
}

function ExpenseRow({ expense, members, currency, baseCurrency, displayMinor, onOpen }) {
  const settlement = expense.split === "settlement";
  const payee = expense.payee || members.find((member) => member.id !== expense.payer)?.id;
  const original = formatMoney(toMinor(expense.originalAmount ?? expense.amount), expense.currency || baseCurrency);
  const display = settlement
    ? formatMoney(toMinor(expense.originalAmount ?? expense.amountBase), expense.currency || baseCurrency)
    : formatMoney(displayMinor ?? expenseBaseMinor(expense), currency);
  const who = settlement
    ? `${memberName(members, expense.payer)} → ${memberName(members, payee)}`
    : memberName(members, expense.payer);
  return (
    <button type="button" className="row" onClick={onOpen}>
      <span className={`badge ${expense.currency === "EUR" ? "eur" : ""}`}>{expense.currency === "EUR" ? "EUR" : "Kč"}</span>
      <span>
        <b>{expense.title}</b>
        <small>{formatDate(expense.date)} · {who}{display !== original ? ` · ${original}` : ""}</small>
      </span>
      <strong>{display}</strong>
    </button>
  );
}

function Detail({ expense, members, onBack }) {
  const currency = expense.currency || expense.baseCurrency || "CZK";
  const base = expense.baseCurrency || "CZK";
  const original = formatMoney(toMinor(expense.originalAmount ?? expense.amount), currency);
  const ledger = formatMoney(expenseBaseMinor(expense), base);
  const settlement = expense.split === "settlement";
  const ids = expense.participantIds || Object.keys(expense.shares || {});
  return (
    <>
      <header className="topbar">
        <button type="button" className="back" onClick={onBack} aria-label="Zpět"><ChevronLeft size={20} /></button>
        <div>
          <p className="eyebrow">{settlement ? "Vyrovnání" : "Detail výdaje"}</p>
          <strong>{expense.title}</strong>
        </div>
      </header>
      <main className="screen detail" data-testid="expense-detail">
        <p className="meta">{formatDate(expense.date)} · {expense.category}</p>
        {settlement ? (
          <p className="lede">{memberName(members, expense.payer)} zaplatil(a) {memberName(members, expense.payee || members.find((member) => member.id !== expense.payer)?.id)}. Zápis vznikl až potvrzením, ne odesláním platby.</p>
        ) : (
          <p className="lede">Platil(a) {memberName(members, expense.payer)}. {expense.split === "equal" ? "Rovnoměrně." : expense.split === "exact" ? "Přesné částky." : expense.split === "items" ? "Podle položek." : "Ruční podíl."}</p>
        )}
        <dl className="facts">
          <div><dt>Původní částka</dt><dd>{original}</dd></div>
          <div><dt>Použitý kurz</dt><dd>{currency === "EUR" || base === "EUR" ? `1 EUR = ${formatRate(expense.rate || 1)} Kč` : "1"}</dd></div>
          <div><dt>Zdroj kurzu</dt><dd data-testid="detail-rate-source">{rateLabel(expense.rateSource, expense.rateDate)}</dd></div>
          <div><dt>V účetnictví</dt><dd data-testid="detail-base">{ledger}</dd></div>
        </dl>
        {expense.rateSource === "legacy" && <p className="note">Původní záznam neměl měnu. Doplněno jako Kč, kurz 1, částka beze změny.</p>}
        {!settlement && (
          <>
            <h2>Podíly v účetnictví</h2>
            <div className="share-list">
              {ids.map((id) => (
                <div key={id}><span>{memberName(members, id)}</span><b>{formatMoney(expense.shares?.[id] || 0, base)}</b></div>
              ))}
            </div>
          </>
        )}
        {expense.items?.length > 0 && (
          <>
            <h2>Položky</h2>
            <div className="rows">
              {expense.items.map((item, index) => (
                <div className="transfer" key={`${item.name}-${index}`}>
                  <b>{item.name || "Položka"}</b>
                  <small>{item.mode === "shared" ? "Společná položka" : "Po kusech"} · {formatMoney(toMinor(item.unitPrice || 0), currency)}</small>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}

function AddExpense({ group, quote, quoteReady, onCancel, onSave }) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [amountText, setAmountText] = useState("");
  const [currency, setCurrency] = useState(group.baseCurrency);
  const [rateText, setRateText] = useState(quote ? formatRate(quote.rate) : "");
  const [rateTouched, setRateTouched] = useState(false);
  const [payer, setPayer] = useState(group.members[0]?.id || "");
  const [participants, setParticipants] = useState(group.members.map((member) => member.id));
  const [split, setSplit] = useState("equal");
  const [exact, setExact] = useState({});
  const [items, setItems] = useState([]);
  const [category, setCategory] = useState(group.baseCurrency === "EUR" ? "Restaurace" : "Jídlo a drogerie");
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState("");

  useEffect(() => {
    if (!rateTouched && quote) setRateText(formatRate(quote.rate));
  }, [quote, rateTouched]);

  const amount = parseAmount(amountText);
  const rate = parseRate(rateText);
  const meta = rateMetaFromInput(quote, rate, rateTouched);
  const needsRate = currency !== group.baseCurrency;
  const rateCaption = needsRate && !quoteReady && !rateTouched
    ? "Načítám orientační kurz…"
    : rateLabel(needsRate ? meta.rateSource : (currency === "CZK" ? "czk" : "base"), needsRate ? meta.rateDate : null);
  const engineItems = items.map((item) => ({
    name: item.name,
    unitPrice: parseAmount(item.unitText) || 0,
    mode: item.mode,
    counts: item.counts,
    sharedAmong: item.sharedAmong,
    quantity: Number(String(item.quantityText).replace(",", ".")) || 0,
  }));
  const exactAmounts = Object.fromEntries(participants.map((id) => [id, parseAmount(exact[id]) || 0]));
  let preview = null;
  if (amount) {
    try {
      const original = originalSharesFor({
        originalAmount: amount,
        participantIds: participants,
        split,
        exactAmounts,
        items: engineItems,
      });
      const projected = projectSharesToBase(original.shares, currency, group.baseCurrency, needsRate ? rate || 1 : 1);
      preview = { ...original, baseShares: projected.shares };
    } catch (caught) {
      preview = { error: caught.message, unassigned: 0, shares: {}, baseShares: {} };
    }
  }

  function toggleParticipant(id) {
    setParticipants((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function chooseSplit(next) {
    setSplit(next);
    if (next === "items" && items.length === 0) {
      setItems([blankItem(participants)]);
    }
  }

  function validate(index) {
    if (index === 0) {
      if (!title.trim()) return "Doplň název.";
      if (!amount) return "Zadej částku větší než nula.";
      if (needsRate && !rate) return "Zadej kurz, kolik Kč je 1 EUR.";
    }
    if (index === 2 && participants.length === 0) return "Vyber, pro koho výdaj je.";
    return "";
  }

  function save() {
    const problem = validate(0) || validate(2);
    if (problem || !preview || preview.unassigned !== 0) {
      setError(problem || (preview?.unassigned > 0 ? "Ještě zbývá část účtenky." : "Součet podílů se musí rovnat účtence."));
      return;
    }
    try {
      onSave(buildExpense({
        id: nextId(group.expenses),
        title,
        originalAmount: amount,
        currency,
        baseCurrency: group.baseCurrency,
        rate: needsRate ? meta.rate : 1,
        rateSource: needsRate ? meta.rateSource : undefined,
        rateDate: needsRate ? meta.rateDate : null,
        payer,
        participantIds: participants,
        split,
        exactAmounts,
        items: engineItems,
        category,
        date,
      }));
    } catch (caught) {
      setError(caught.message);
    }
  }

  const steps = ["Částka", "Kdo platil", "Pro koho", "Rozdělení"];
  return (
    <>
      <header className="topbar">
        <button type="button" className="back" onClick={step === 0 ? onCancel : () => { setError(""); setStep(step - 1); }} aria-label="Zpět"><ChevronLeft size={20} /></button>
        <div>
          <p className="eyebrow">Krok {step + 1} ze 4 · {steps[step]}</p>
          <strong>Nový výdaj</strong>
        </div>
      </header>
      <main className="screen">
        {step === 0 && (
          <section>
            <label className="field"><span>Název</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Například večeře" /></label>
            <label className="field">
              <span>Částka z účtenky</span>
              <div className="amount-line">
                <input autoFocus inputMode="decimal" data-testid="amount-input" value={amountText} onChange={(event) => setAmountText(event.target.value)} placeholder="0,00" />
                <CurrencyToggle value={currency} onChange={setCurrency} testId="expense-currency" label="Měna výdaje" />
              </div>
            </label>
            <p className="note">Piš částku z účtenky. Směna, kterou si platící udělal třeba na Revolutu, do skupiny nepatří.</p>
            {needsRate && (
              <div className="rate-box" data-testid="eur-conversion">
                <p>Přepočet do {group.baseCurrency === "EUR" ? "EUR" : "Kč"}: <b data-testid="conversion">{amount && rate ? formatMoney(projectSharesToBase({ all: toMinor(amount) }, currency, group.baseCurrency, rate).baseMinor, group.baseCurrency) : "—"}</b></p>
                <label className="rate-equation">
                  <span>1 EUR =</span>
                  <input inputMode="decimal" aria-label="Kurz eura" data-testid="rate-input" value={rateText} onChange={(event) => { setRateTouched(true); setRateText(event.target.value); }} />
                  <span>Kč</span>
                </label>
                <small data-testid="rate-source">{rateCaption}</small>
              </div>
            )}
          </section>
        )}
        {step === 1 && (
          <section>
            <p className="field-label">Kdo platil</p>
            <div className="choice" role="group" aria-label="Kdo platil">
              {group.members.map((member) => (
                <button key={member.id} type="button" className={payer === member.id ? "active" : ""} onClick={() => setPayer(member.id)}>{member.name}</button>
              ))}
            </div>
          </section>
        )}
        {step === 2 && (
          <section>
            <p className="field-label">Pro koho</p>
            <div className="people">
              <button type="button" onClick={() => setParticipants(group.members.map((member) => member.id))}>Všichni</button>
              {group.members.map((member) => (
                <button key={member.id} type="button" className={participants.includes(member.id) ? "active" : ""} onClick={() => toggleParticipant(member.id)}>{member.name}</button>
              ))}
            </div>
            <p className="note">Platící mezi nimi být nemusí. Vybraní se o účtenku dělí, ostatní ne.</p>
          </section>
        )}
        {step === 3 && (
          <section>
            <div className="choice" role="group" aria-label="Způsob rozdělení">
              <button type="button" className={split === "equal" ? "active" : ""} data-testid="split-equal" onClick={() => chooseSplit("equal")}>Rovnoměrně<small>Mezi vybranými</small></button>
              <button type="button" className={split === "exact" ? "active" : ""} data-testid="split-exact" onClick={() => chooseSplit("exact")}>Přesné částky<small>Každý svou sumu</small></button>
              <button type="button" className={split === "items" ? "active" : ""} data-testid="split-items" onClick={() => chooseSplit("items")}>Podle položek<small>Kousky, jídla i společné věci</small></button>
            </div>
            {split === "exact" && participants.map((id) => (
              <label className="exact-row" key={id}>
                <span>{memberName(group.members, id)}</span>
                <input inputMode="decimal" aria-label={`Částka pro ${memberName(group.members, id)}`} value={exact[id] || ""} placeholder="0,00" onChange={(event) => setExact((current) => ({ ...current, [id]: event.target.value }))} />
                <button type="button" className="link" onClick={() => assignRemainder(id)}>Zbytek</button>
              </label>
            ))}
            {split === "items" && (
              <ItemEditor items={items} setItems={setItems} participants={participants} members={group.members} currency={currency} />
            )}
            <SharePreview preview={preview} members={group.members} participants={participants} currency={currency} baseCurrency={group.baseCurrency} />
            <label className="field">
              <span>Kategorie</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {CATEGORIES.filter((item) => item !== "Vyrovnání").map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label className="field"><span>Datum</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          </section>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </main>
      <div className="bottombar">
        {step < 3
          ? <button type="button" className="big-cta" onClick={() => { const problem = validate(step); setError(problem); if (!problem) setStep(step + 1); }}>Pokračovat</button>
          : <button type="button" className="big-cta" onClick={save}>Uložit výdaj</button>}
      </div>
    </>
  );

  function assignRemainder(id) {
    if (!amount) return;
    const others = participants.filter((item) => item !== id).reduce((sum, item) => sum + toMinor(parseAmount(exact[item]) || 0), 0);
    const rest = toMinor(amount) - others;
    if (rest < 0) return;
    setExact((current) => ({ ...current, [id]: minorToInput(rest) }));
  }
}

function blankItem(participantIds) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: "",
    unitText: "",
    mode: "counts",
    counts: Object.fromEntries(participantIds.map((id) => [id, 0])),
    sharedAmong: [...participantIds],
    quantityText: "1",
  };
}

function ItemEditor({ items, setItems, participants, members, currency }) {
  function update(id, patch) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }
  return (
    <div data-testid="item-editor">
      {items.map((item) => {
        const unit = parseAmount(item.unitText) || 0;
        const countSum = participants.reduce((sum, id) => sum + (item.counts?.[id] || 0), 0);
        const quantity = Number(String(item.quantityText).replace(",", ".")) || 0;
        const line = item.mode === "shared" ? toMinor(unit) * quantity : toMinor(unit) * countSum;
        return (
          <article className="item" key={item.id}>
            <label className="field"><span>Položka</span><input value={item.name} placeholder="Například pivo" onChange={(event) => update(item.id, { name: event.target.value })} /></label>
            <label className="field"><span>Cena za kus ({currency === "EUR" ? "EUR" : "Kč"})</span><input inputMode="decimal" value={item.unitText} placeholder="0,00" onChange={(event) => update(item.id, { unitText: event.target.value })} /></label>
            <div className="seg names">
              <button type="button" className={item.mode === "counts" ? "active" : ""} onClick={() => update(item.id, { mode: "counts" })}>Po kusech</button>
              <button type="button" className={item.mode === "shared" ? "active" : ""} onClick={() => update(item.id, { mode: "shared" })}>Společně</button>
            </div>
            {item.mode === "counts" ? participants.map((id) => (
              <div className="stepper" key={id}>
                <span>{memberName(members, id)}</span>
                <span>
                  <button type="button" className="icon-btn" aria-label={`Méně pro ${memberName(members, id)}`} onClick={() => update(item.id, { counts: { ...item.counts, [id]: Math.max(0, (item.counts?.[id] || 0) - 1) } })}>−</button>
                  <b>{item.counts?.[id] || 0}</b>
                  <button type="button" className="icon-btn" aria-label={`Víc pro ${memberName(members, id)}`} onClick={() => update(item.id, { counts: { ...item.counts, [id]: (item.counts?.[id] || 0) + 1 } })}>+</button>
                </span>
              </div>
            )) : (
              <>
                <label className="field"><span>Počet</span><input inputMode="decimal" value={item.quantityText} onChange={(event) => update(item.id, { quantityText: event.target.value })} /></label>
                <div className="people">
                  <button type="button" onClick={() => update(item.id, { sharedAmong: [...participants] })}>Všichni vybraní</button>
                  {participants.map((id) => (
                    <button key={id} type="button" className={item.sharedAmong?.includes(id) ? "active" : ""} onClick={() => {
                      const has = item.sharedAmong?.includes(id);
                      update(item.id, { sharedAmong: has ? item.sharedAmong.filter((itemId) => itemId !== id) : [...(item.sharedAmong || []), id] });
                    }}>{memberName(members, id)}</button>
                  ))}
                </div>
              </>
            )}
            <p className="quiet">Položka celkem {formatMoney(line, currency)}</p>
            <button type="button" className="link" onClick={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))}>Odebrat položku</button>
          </article>
        );
      })}
      <button type="button" className="link" onClick={() => setItems((current) => [...current, blankItem(participants)])}>Přidat položku</button>
    </div>
  );
}

function SharePreview({ preview, members, participants, currency, baseCurrency }) {
  if (!preview) return null;
  const unassigned = preview.unassigned || 0;
  return (
    <div>
      <p className={unassigned === 0 ? "remain ok" : "remain bad"} data-testid="unassigned">
        {unassigned === 0 ? "Účtenka sedí." : unassigned > 0 ? `Zbývá rozdělit ${formatMoney(unassigned, currency)}` : `Přesahuje o ${formatMoney(-unassigned, currency)}`}
      </p>
      <div className="share-list">
        {participants.map((id) => (
          <div key={id}>
            <span>{memberName(members, id)}</span>
            <b>{formatMoney(preview.shares?.[id] || 0, currency)}{baseCurrency !== currency ? ` · ${formatMoney(preview.baseShares?.[id] || 0, baseCurrency)}` : ""}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function Settle({ group, transfer, displayRate, quoteReady, onCancel, onSave }) {
  const [currency, setCurrency] = useState(group.baseCurrency);
  const [rateText, setRateText] = useState(formatRate(displayRate.rate));
  const [rateTouched, setRateTouched] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [error, setError] = useState("");
  const rate = parseRate(rateText);
  const meta = rateMetaFromInput(displayRate, rate, rateTouched);
  const needsRate = currency !== group.baseCurrency;

  useEffect(() => {
    if (!rateTouched) setRateText(formatRate(displayRate.rate));
  }, [displayRate, rateTouched]);

  useEffect(() => {
    if (amountTouched) return;
    if (!needsRate) {
      setAmountText(minorToInput(transfer.minor));
      return;
    }
    if (!rate) return;
    const converted = projectSharesToBase({ all: transfer.minor }, group.baseCurrency, currency, rate).baseMinor;
    setAmountText(minorToInput(converted));
  }, [amountTouched, currency, needsRate, rate, transfer.minor, group.baseCurrency]);

  function confirm() {
    const entered = parseAmount(amountText);
    if (entered == null || entered <= 0) {
      setError("Zadej částku větší než nula.");
      return;
    }
    if (needsRate && !rate) {
      setError("Zadej kurz, kolik Kč je 1 EUR.");
      return;
    }
    onSave(buildSettlement({
      id: nextId(group.expenses),
      payer: transfer.from,
      payee: transfer.to,
      currency,
      baseCurrency: group.baseCurrency,
      originalAmount: entered,
      rate: needsRate ? meta.rate : 1,
      rateSource: needsRate ? meta.rateSource : undefined,
      rateDate: needsRate ? meta.rateDate : null,
      debtMinor: transfer.minor,
      settlementMode: amountTouched ? "custom" : "full-debt",
      date: todayISO(),
    }));
  }

  return (
    <>
      <header className="topbar">
        <button type="button" className="back" onClick={onCancel} aria-label="Zpět"><ChevronLeft size={20} /></button>
        <div>
          <p className="eyebrow">Vyrovnání</p>
          <strong>{memberName(group.members, transfer.from)} → {memberName(group.members, transfer.to)}</strong>
        </div>
      </header>
      <main className="screen">
        <p className="note">Nejdřív pošli peníze, třeba přes Revolut. Zigo platbu samo neoznačí. Tady jen potvrdíš, že tahle jedna platba opravdu proběhla.</p>
        <p className="lede">V účetnictví je to {formatMoney(transfer.minor, group.baseCurrency)}.</p>
        <div className="overview-switch">
          <span>Měna platby</span>
          <CurrencyToggle value={currency} onChange={(next) => { setCurrency(next); setAmountTouched(false); }} testId="settlement-currency" label="Měna platby" />
        </div>
        <label className="field"><span>Částka</span><input inputMode="decimal" data-testid="settlement-amount" value={amountText} onChange={(event) => { setAmountTouched(true); setAmountText(event.target.value); }} /></label>
        {needsRate && (
          <div className="rate-box">
            <label className="rate-equation">
              <span>1 EUR =</span>
              <input inputMode="decimal" aria-label="Kurz vyrovnání" value={rateText} onChange={(event) => { setRateTouched(true); setRateText(event.target.value); }} />
              <span>Kč</span>
            </label>
            <small>{!quoteReady && !rateTouched ? "Načítám orientační kurz…" : rateLabel(meta.rateSource, meta.rateDate)}</small>
          </div>
        )}
        {!amountTouched && <p className="note">Do účtů se zapíše celý tento dluh. Ostatní návrhy zůstanou otevřené.</p>}
        {amountTouched && <p className="note">Do účtů se zapíše přepočet zadané částky. Dluh se nemusí vynulovat.</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </main>
      <div className="bottombar">
        <button type="button" className="big-cta" onClick={confirm}>Potvrdit vyrovnání</button>
      </div>
    </>
  );
}

function GroupSettings({ group, onBack, onChange }) {
  const [notice, setNotice] = useState("");
  const [draftName, setDraftName] = useState("");
  const used = new Set(group.expenses.flatMap((expense) => [expense.payer, expense.payee, ...(expense.participantIds || []), ...Object.keys(expense.shares || {})]));

  function setBase(currency) {
    if (currency === group.baseCurrency) return;
    if (group.expenses.length > 0) {
      setNotice(`Tahle skupina už má výdaje v ${group.baseCurrency === "EUR" ? "eurech" : "korunách"}. Měna účetnictví zůstává, aby se staré částky nepřepočítaly.`);
      return;
    }
    setNotice("");
    onChange({ baseCurrency: currency });
  }

  return (
    <>
      <header className="topbar">
        <button type="button" className="back" onClick={onBack} aria-label="Zpět"><ChevronLeft size={20} /></button>
        <div>
          <p className="eyebrow">Skupina</p>
          <strong>{group.name}</strong>
        </div>
      </header>
      <main className="screen">
        <label className="field">
          <span>Název</span>
          <input value={group.name} onChange={(event) => onChange({ name: event.target.value })} />
        </label>
        <div className="overview-switch">
          <span>Měna účetnictví</span>
          <CurrencyToggle value={group.baseCurrency} onChange={setBase} testId="group-currency" label="Měna účetnictví skupiny" />
        </div>
        <p className="note">
          {group.baseCurrency === "EUR"
            ? "Nové výdaje, přehled i návrhy vyrovnání začínají v eurech. Účtenku i zobrazení můžeš pořád přepnout na Kč."
            : "Nové výdaje, přehled i návrhy vyrovnání začínají v korunách. Účtenku i zobrazení můžeš pořád přepnout na EUR."}
        </p>
        {notice && <p className="error">{notice}</p>}
        <h2>Lidé</h2>
        {group.members.map((member) => (
          <div className="member-edit" key={member.id}>
            <input aria-label={`Jméno ${member.name}`} value={member.name} onChange={(event) => onChange({
              members: group.members.map((item) => item.id === member.id ? { ...item, name: event.target.value } : item),
            })} />
            <button type="button" className="link" onClick={() => {
              if (used.has(member.id)) {
                setNotice("Tohoto člověka už výdaj používá, nejde ho odebrat.");
                return;
              }
              onChange({ members: group.members.filter((item) => item.id !== member.id) });
            }}>Odebrat</button>
          </div>
        ))}
        <div className="member-edit">
          <input aria-label="Nové jméno" value={draftName} placeholder="Nové jméno" onChange={(event) => setDraftName(event.target.value)} />
          <button type="button" className="link" onClick={() => {
            const name = draftName.trim();
            if (!name) return;
            onChange({ members: [...group.members, { id: `m${Date.now()}`, name }] });
            setDraftName("");
          }}>Přidat</button>
        </div>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
