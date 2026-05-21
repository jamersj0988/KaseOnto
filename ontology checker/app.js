const issues = [
  {
    id: "missing-parent",
    title: "Class has no parent",
    severity: "critical",
    className: "AdaptiveFacade",
    message: "AdaptiveFacade is currently detached from the upper ontology.",
    rule: "Every domain class should connect to exactly one stable parent branch.",
    suggestion: "Attach AdaptiveFacade under BuildingElement or create a narrower facade branch.",
    snippet: "Class: AdaptiveFacade\n  SubClassOf: none\n  Label: adaptive facade",
  },
  {
    id: "duplicate-label",
    title: "Duplicate preferred label",
    severity: "warning",
    className: "PublicSpace",
    message: "PublicSpace and OpenSpace both use the label public space.",
    rule: "Preferred labels should be unique inside the review ontology.",
    suggestion: "Keep public space on PublicSpace and move the alternate wording to skos:altLabel.",
    snippet: "PublicSpace  skos:prefLabel  \"public space\"\nOpenSpace    skos:prefLabel  \"public space\"",
  },
  {
    id: "missing-definition",
    title: "Definition missing",
    severity: "warning",
    className: "FloodMitigation",
    message: "FloodMitigation has a label but no definition text.",
    rule: "Reviewed classes need rdfs:comment or skos:definition.",
    suggestion: "Add a concise scope note before publishing this branch.",
    snippet: "Class: FloodMitigation\n  Label: flood mitigation\n  Definition: none",
  },
  {
    id: "domain-range",
    title: "Domain/range mismatch",
    severity: "critical",
    className: "hasParticipant",
    message: "hasParticipant points from Event to Site in one assertion.",
    rule: "hasParticipant expects Event to Participant.",
    suggestion: "Change the object class to CommunityGroup or move the relation to takesPlaceAt.",
    snippet: "DesignWorkshop hasParticipant RiverfrontSite",
  },
  {
    id: "orphan-instance",
    title: "Instance references unknown class",
    severity: "critical",
    className: "PermeablePavementCase",
    message: "PermeablePavementCase references DesignStrategy, which is not in the draft.",
    rule: "Every instance type must resolve to an existing class.",
    suggestion: "Map DesignStrategy to Strategy or add the missing class intentionally.",
    snippet: "PermeablePavementCase rdf:type DesignStrategy",
  },
  {
    id: "weak-label",
    title: "Weak class label",
    severity: "warning",
    className: "Issue",
    message: "Issue is broad and overlaps with Problem, Risk, and Constraint.",
    rule: "Top-level labels should be precise enough for annotation decisions.",
    suggestion: "Split by review intent or define Issue as an umbrella branch.",
    snippet: "Class: Issue\n  Children: Problem, Risk, Constraint",
  },
];

const classes = [
  { name: "DesignCase", tags: ["root", "reviewed", "case"] },
  { name: "BuildingElement", tags: ["branch", "material", "component"] },
  { name: "AdaptiveFacade", tags: ["detached", "needs parent"] },
  { name: "PublicSpace", tags: ["duplicate label", "site"] },
  { name: "OpenSpace", tags: ["duplicate label", "site"] },
  { name: "FloodMitigation", tags: ["missing definition", "strategy"] },
  { name: "hasParticipant", tags: ["property", "range check"] },
  { name: "PermeablePavementCase", tags: ["instance", "unknown type"] },
  { name: "CommunityGroup", tags: ["participant", "agent"] },
  { name: "RiverfrontSite", tags: ["site", "location"] },
];

const state = {
  filter: "all",
  query: "",
  classQuery: "",
  selectedId: issues[0].id,
  fontSize: 15,
};

const issueList = document.querySelector("#issue-list");
const issueDetail = document.querySelector("#issue-detail");
const issueSearch = document.querySelector("#issue-search");
const classSearch = document.querySelector("#class-search");
const classList = document.querySelector("#class-list");
const selectedClassLabel = document.querySelector("#selected-class-label");
const selectedSeverityLabel = document.querySelector("#selected-severity-label");
const checkerStatus = document.querySelector("#checker-status");
const issueCount = document.querySelector("#issue-count");

function selectedIssue() {
  return issues.find((issue) => issue.id === state.selectedId) || issues[0];
}

function filteredIssues() {
  return issues.filter((issue) => {
    const matchesFilter = state.filter === "all" || issue.severity === state.filter;
    const searchable = `${issue.title} ${issue.className} ${issue.message}`.toLowerCase();
    return matchesFilter && searchable.includes(state.query.toLowerCase());
  });
}

function renderIssues() {
  const visibleIssues = filteredIssues();
  issueList.innerHTML = "";
  visibleIssues.forEach((issue) => {
    const button = document.createElement("button");
    button.className = "issue-chip";
    button.type = "button";
    button.dataset.severity = issue.severity;
    button.classList.toggle("is-selected", issue.id === state.selectedId);
    button.innerHTML = `<span>${issue.title}</span><small>${issue.severity}</small>`;
    button.addEventListener("click", () => {
      state.selectedId = issue.id;
      render();
    });
    issueList.append(button);
  });

  if (visibleIssues.length === 0) {
    const empty = document.createElement("div");
    empty.className = "issue-chip";
    empty.innerHTML = "<span>No matching issues</span><small>empty</small>";
    issueList.append(empty);
  }
}

function renderDetail() {
  const issue = selectedIssue();
  selectedClassLabel.textContent = issue.className;
  selectedSeverityLabel.textContent = issue.severity;
  issueDetail.innerHTML = `
    <h3>${issue.title}</h3>
    <div class="detail-meta">
      <span>${issue.severity}</span>
      <span>${issue.className}</span>
      <span>${issue.id}</span>
    </div>
    <p>${issue.message}</p>
    <p><strong>Rule:</strong> ${issue.rule}</p>
    <p><strong>Suggestion:</strong> ${issue.suggestion}</p>
    <pre><code>${issue.snippet}</code></pre>
  `;
}

function renderClasses() {
  const active = selectedIssue();
  const query = state.classQuery.toLowerCase();
  const visibleClasses = classes.filter((item) => {
    const searchable = `${item.name} ${item.tags.join(" ")}`.toLowerCase();
    return searchable.includes(query);
  });

  classList.innerHTML = "";
  visibleClasses.forEach((item) => {
    const row = document.createElement("button");
    row.className = "class-row";
    row.type = "button";
    row.classList.toggle("is-active", item.name === active.className);
    row.innerHTML = `
      <strong>${item.name}</strong>
      <div>${item.tags.map((tag) => `<span class="class-pill">${tag}</span>`).join("")}</div>
    `;
    row.addEventListener("click", () => {
      const match = issues.find((issue) => issue.className === item.name);
      if (match) {
        state.selectedId = match.id;
        render();
      }
    });
    classList.append(row);
  });
}

function render() {
  renderIssues();
  renderDetail();
  renderClasses();
  issueCount.textContent = issues.length.toString();
}

document.querySelectorAll(".issue-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".issue-tab").forEach((item) => {
      item.classList.remove("is-active");
      item.setAttribute("aria-selected", "false");
    });
    tab.classList.add("is-active");
    tab.setAttribute("aria-selected", "true");
    state.filter = tab.dataset.filter;
    renderIssues();
  });
});

issueSearch.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderIssues();
});

classSearch.addEventListener("input", (event) => {
  state.classQuery = event.target.value;
  renderClasses();
});

document.querySelector("#increase-font").addEventListener("click", () => {
  state.fontSize = Math.min(21, state.fontSize + 1);
  document.documentElement.style.setProperty("--reader-font-size", `${state.fontSize}px`);
});

document.querySelector("#decrease-font").addEventListener("click", () => {
  state.fontSize = Math.max(13, state.fontSize - 1);
  document.documentElement.style.setProperty("--reader-font-size", `${state.fontSize}px`);
});

document.querySelector("#run-check").addEventListener("click", () => {
  checkerStatus.textContent = "Checked";
});

document.querySelector("#export-report").addEventListener("click", () => {
  checkerStatus.textContent = "Report ready";
});

document.querySelector("#mark-resolved").addEventListener("click", () => {
  checkerStatus.textContent = "Marked";
});

render();
