const state = {
  transitions: [],
  states: [],
};

mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });

document.getElementById("analyzeBtn").addEventListener("click", analyzeST);
document.addEventListener("DOMContentLoaded", analyzeST);

function analyzeST() {
  const input = document.getElementById("stInput").value;
  const status = document.getElementById("status");

  try {
    const parsed = parseStructuredText(input);
    state.transitions = parsed.transitions;
    state.states = parsed.states;

    if (state.transitions.length === 0) {
      status.textContent =
        "Переходы не найдены. Используйте CASE State OF ... и присваивания State := ...";
      renderDiagram([]);
      renderKarnaughMaps([], []);
      return;
    }

    status.textContent = `Найдено состояний: ${state.states.length}, переходов: ${state.transitions.length}`;
    renderDiagram(state.transitions);
    renderKarnaughMaps(state.transitions, state.states);
  } catch (error) {
    status.textContent = `Ошибка анализа: ${error.message}`;
  }
}

function parseStructuredText(source) {
  const clean = source
    .replace(/\(\*[\s\S]*?\*\)/g, "")
    .replace(/\/\/.*$/gm, "");

  const lines = clean
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const transitions = [];
  const states = new Set();

  let inCase = false;
  let currentState = null;
  let activeCondition = "TRUE";

  for (const line of lines) {
    if (/^CASE\s+\w+\s+OF\b/i.test(line)) {
      inCase = true;
      continue;
    }

    if (!inCase) continue;

    if (/^END_CASE\s*;?$/i.test(line)) {
      inCase = false;
      currentState = null;
      activeCondition = "TRUE";
      continue;
    }

    const stateHeaderMatch = line.match(/^([A-Za-z_][\w]*)\s*:\s*$/);
    if (stateHeaderMatch) {
      currentState = stateHeaderMatch[1];
      states.add(currentState);
      activeCondition = "TRUE";
      continue;
    }

    const ifMatch = line.match(/^IF\s+(.+)\s+THEN\s*$/i);
    if (ifMatch) {
      activeCondition = normalizeCondition(ifMatch[1]);
      continue;
    }

    const elsifMatch = line.match(/^ELSIF\s+(.+)\s+THEN\s*$/i);
    if (elsifMatch) {
      activeCondition = normalizeCondition(elsifMatch[1]);
      continue;
    }

    if (/^ELSE\s*$/i.test(line)) {
      activeCondition = "ELSE";
      continue;
    }

    if (/^END_IF\s*;?$/i.test(line)) {
      activeCondition = "TRUE";
      continue;
    }

    const transitionMatch = line.match(/^(\w+)\s*:=\s*(\w+)\s*;?$/);
    if (transitionMatch) {
      const lhs = transitionMatch[1];
      const to = transitionMatch[2];

      if (lhs.toLowerCase() === "state" && currentState) {
        states.add(to);
        transitions.push({
          from: currentState,
          to,
          condition: activeCondition,
        });
      }
    }
  }

  return {
    transitions,
    states: Array.from(states),
  };
}

function normalizeCondition(raw) {
  return raw.replace(/\s+/g, " ").trim();
}

function renderDiagram(transitions) {
  const container = document.getElementById("diagram");

  if (transitions.length === 0) {
    container.innerHTML = "<p>Нет данных для диаграммы.</p>";
    return;
  }

  const edges = transitions
    .map((t) => `${t.from} -->|${escapeMermaidLabel(t.condition)}| ${t.to}`)
    .join("\n");

  const definition = `stateDiagram-v2\n${edges}`;
  const id = `diag-${Date.now()}`;

  mermaid
    .render(id, definition)
    .then(({ svg }) => {
      container.innerHTML = svg;
    })
    .catch((e) => {
      container.innerHTML = `<pre>${definition}</pre><p>Ошибка рендера Mermaid: ${e.message}</p>`;
    });
}

function escapeMermaidLabel(text) {
  return String(text).replace(/[|]/g, "\\|");
}

function renderKarnaughMaps(transitions, states) {
  const root = document.getElementById("karnaughContainer");
  root.innerHTML = "";

  if (!transitions.length) {
    root.innerHTML = "<p>Нет переходов для построения карт Карно.</p>";
    return;
  }

  const conditions = extractUniqueConditions(transitions);
  const vars = extractVariables(conditions).slice(0, 4);

  if (vars.length === 0) {
    root.innerHTML = "<p>Не удалось выделить логические переменные из условий.</p>";
    return;
  }

  const mapRows = grayCode(vars.length > 2 ? 2 : 1);
  const mapCols = grayCode(vars.length === 1 ? 1 : vars.length - mapRows[0].length);

  for (const fromState of states) {
    const perStateTransitions = transitions.filter((t) => t.from === fromState);
    if (!perStateTransitions.length) continue;

    const wrapper = document.createElement("article");
    wrapper.className = "kmap";

    const title = document.createElement("h3");
    title.textContent = `Состояние ${fromState}`;
    wrapper.appendChild(title);

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const firstHead = document.createElement("th");
    firstHead.textContent = rowLabel(vars, mapRows[0].length);
    headRow.appendChild(firstHead);

    mapCols.forEach((c) => {
      const th = document.createElement("th");
      th.textContent = c;
      headRow.appendChild(th);
    });

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    mapRows.forEach((rowBits) => {
      const tr = document.createElement("tr");
      const rowHead = document.createElement("th");
      rowHead.textContent = rowBits;
      tr.appendChild(rowHead);

      mapCols.forEach((colBits) => {
        const assignmentBits = rowBits + colBits;
        const assignment = buildAssignment(vars, assignmentBits);
        const matched = perStateTransitions.find((t) => evalCondition(t.condition, assignment));

        const td = document.createElement("td");
        if (matched) {
          td.textContent = matched.to;
          td.classList.add("active");
        } else {
          td.textContent = "·";
        }
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);

    const note = document.createElement("p");
    note.style.margin = "0.5rem 0.8rem";
    note.textContent = `Переменные: ${vars.join(", ")} (до 4)`;

    wrapper.appendChild(table);
    wrapper.appendChild(note);
    root.appendChild(wrapper);
  }
}

function extractUniqueConditions(transitions) {
  return [...new Set(transitions.map((t) => t.condition))];
}

function extractVariables(conditions) {
  const keywords = new Set(["AND", "OR", "NOT", "TRUE", "FALSE", "ELSE"]);
  const vars = new Set();

  conditions.forEach((cond) => {
    const tokens = cond.match(/[A-Za-z_][\w]*/g) || [];
    tokens.forEach((token) => {
      if (!keywords.has(token.toUpperCase())) vars.add(token);
    });
  });

  return Array.from(vars);
}

function grayCode(bits) {
  if (bits <= 0) return [""];
  if (bits === 1) return ["0", "1"];
  const prev = grayCode(bits - 1);
  return [...prev.map((v) => `0${v}`), ...[...prev].reverse().map((v) => `1${v}`)];
}

function rowLabel(vars, rowBitsLength) {
  return vars.slice(0, rowBitsLength).join("") || "—";
}

function buildAssignment(vars, bits) {
  const assignment = {};
  vars.forEach((v, idx) => {
    assignment[v] = bits[idx] === "1";
  });
  return assignment;
}

function evalCondition(cond, assignment) {
  if (cond === "TRUE" || cond === "ELSE") return true;

  let expr = ` ${cond} `;

  for (const [name, value] of Object.entries(assignment)) {
    expr = expr.replace(new RegExp(`\\b${name}\\b`, "g"), value ? " true " : " false ");
  }

  expr = expr
    .replace(/\bAND\b/gi, "&&")
    .replace(/\bOR\b/gi, "||")
    .replace(/\bNOT\b/gi, "!")
    .replace(/\bTRUE\b/gi, "true")
    .replace(/\bFALSE\b/gi, "false");

  try {
    return !!Function(`"use strict"; return (${expr});`)();
  } catch {
    return false;
  }
}
