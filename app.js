const corpusPath = "./corpus/case53_merged.txt";
const entityPath = "./entity_list/entity_ids_case53.txt";
const ontologyPath = "./ontology/ontology_20.dot";

const els = {
  corpusText: document.querySelector("#corpus-text"),
  corpusStatus: document.querySelector("#corpus-status"),
  fileMeta: document.querySelector("#file-meta"),
  wordCount: document.querySelector("#word-count"),
  lineCount: document.querySelector("#line-count"),
  entityCount: document.querySelector("#entity-count"),
  entityList: document.querySelector("#entity-list"),
  entitySearch: document.querySelector("#entity-search"),
  entityTabs: document.querySelectorAll(".entity-tab"),
  emptyTerms: document.querySelector("#empty-terms"),
  ontologySearch: document.querySelector("#ontology-search"),
  ontologyStatus: document.querySelector("#ontology-status"),
  ontologyTree: document.querySelector("#ontology-tree"),
  selectedTermLabel: document.querySelector("#selected-term-label"),
  selectedClassLabel: document.querySelector("#selected-class-label"),
  savePopulation: document.querySelector("#save-population"),
  exportResults: document.querySelector("#export-results"),
  loadResults: document.querySelector("#load-results"),
  resultsFile: document.querySelector("#results-file"),
  increaseFont: document.querySelector("#increase-font"),
  decreaseFont: document.querySelector("#decrease-font"),
};

let entities = [];
let populatedEntities = [];
let corpusText = "";
let activeEntityId = null;
let hoveredEntityId = null;
let activeTab = "extracted";
let readerFontSize = 15;
let ontology = null;
let ontologyFocusNode = null;
let activeOntologyNode = null;
let ontologyFilter = "";
const ontologyBranchClasses = new Map([
  ["design case", "branch-design-case"],
  ["building", "branch-building"],
  ["event", "branch-event"],
  ["issue", "branch-issue"],
  ["participant", "branch-participant"],
  ["site", "branch-site"],
]);
const ontologyRelationOrder = new Map([
  ["top sense", 0],
  ["sense", 1],
  ["partial", 2],
  ["feature attribute", 3],
  ["data attribute", 4],
]);

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function countWords(text) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function normalizeSearchText(value) {
  return value.toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFlexibleTermPattern(entity) {
  const words = entity.label.trim().split(/\s+/);
  if (words.length < 2) {
    return null;
  }

  const head = words.at(-1);
  const modifier = words.slice(0, -1).join(" ");
  const modifierPattern = escapeRegExp(modifier).replace(/\s+/g, "\\s+");
  const headPattern = escapeRegExp(head).replace(/\s+/g, "\\s+");

  return new RegExp(
    `\\b${modifierPattern}\\b\\s*,(?:(?![.;:\\n]).){0,120}?\\b(?:and|or)\\b(?:(?![.;:\\n]).){0,80}?\\b${headPattern}\\b`,
    "giu",
  );
}

function addMatchIfOpen(matches, occupied, start, end, entity) {
  if (start < 0 || end <= start) {
    return false;
  }

  for (let i = start; i < end; i += 1) {
    if (occupied[i]) {
      return false;
    }
  }

  occupied.fill(1, start, end);
  matches.push({ start, end, entity });
  return true;
}

function parseOntologyDot(dotText) {
  const edgePattern = /"([^"]+)"\s*->\s*"([^"]+)"\s*\[label="([^"]+)"\]/g;
  const nodes = new Set();
  const childrenByParent = new Map();
  const parentByChild = new Map();
  let match;

  while ((match = edgePattern.exec(dotText))) {
    const [, parent, child, relation] = match;
    nodes.add(parent);
    nodes.add(child);

    if (!childrenByParent.has(parent)) {
      childrenByParent.set(parent, []);
    }

    childrenByParent.get(parent).push({ name: child, relation });

    if (!parentByChild.has(child)) {
      parentByChild.set(child, parent);
    }
  }

  for (const children of childrenByParent.values()) {
    children.sort((a, b) => {
      const relationDiff =
        (ontologyRelationOrder.get(a.relation) ?? 99) - (ontologyRelationOrder.get(b.relation) ?? 99);
      return relationDiff || a.name.localeCompare(b.name);
    });
  }

  const root = [...nodes].find((node) => !parentByChild.has(node)) || null;
  return { nodes, childrenByParent, parentByChild, root };
}

function getOntologyAncestors(nodeName) {
  const ancestors = [];
  let current = nodeName;

  while (ontology?.parentByChild.has(current)) {
    current = ontology.parentByChild.get(current);
    ancestors.push(current);
  }

  return ancestors;
}

function getVisibleOntologyNodes() {
  if (!ontologyFilter) {
    return null;
  }

  const visible = new Set();
  const normalizedFilter = ontologyFilter.toLowerCase();

  for (const node of ontology.nodes) {
    if (!node.toLowerCase().includes(normalizedFilter)) {
      continue;
    }

    visible.add(node);
    getOntologyAncestors(node).forEach((ancestor) => visible.add(ancestor));
  }

  return visible;
}

function getOntologyRelation(nodeName) {
  const parent = ontology?.parentByChild.get(nodeName);
  if (!parent) {
    return "";
  }

  return ontology.childrenByParent.get(parent)?.find((child) => child.name === nodeName)?.relation || "";
}

function getOntologyBranchClass(nodeName) {
  if (!ontology?.root) {
    return "";
  }

  if (nodeName === ontology.root) {
    return ontologyBranchClasses.get(nodeName) || "";
  }

  let current = nodeName;
  let parent = ontology.parentByChild.get(current);

  while (parent && parent !== ontology.root) {
    current = parent;
    parent = ontology.parentByChild.get(current);
  }

  return ontologyBranchClasses.get(current) || "";
}

function createOntologyNode(nodeName, relation, depth, options = {}) {
  const { visibleNodes = null, forceExpanded = false, includeChildren = false, isPath = false } = options;
  const children = ontology.childrenByParent.get(nodeName) || [];
  const isExpanded = ontologyFilter || forceExpanded;
  const isMatched = ontologyFilter && nodeName.toLowerCase().includes(ontologyFilter.toLowerCase());

  const wrapper = document.createElement("div");
  wrapper.className = "ontology-node";
  const branchClass = getOntologyBranchClass(nodeName);
  if (branchClass) {
    wrapper.classList.add(branchClass);
  }
  wrapper.classList.toggle("is-path-node", isPath);
  wrapper.style.setProperty("--depth", depth);
  wrapper.dataset.node = nodeName;

  const row = document.createElement("div");
  row.className = "ontology-row";
  row.dataset.node = nodeName;
  row.tabIndex = 0;
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-selected", String(activeOntologyNode === nodeName));
  row.setAttribute("aria-level", String(depth + 1));
  row.classList.toggle("is-selected", activeOntologyNode === nodeName);
  row.classList.toggle("is-match", Boolean(isMatched));

  if (children.length) {
    row.setAttribute("aria-expanded", String(isExpanded));
  }

  const caret = document.createElement("button");
  caret.className = "ontology-caret";
  caret.type = "button";
  caret.setAttribute("aria-label", `${isExpanded ? "Collapse" : "Open"} ${nodeName}`);
  caret.textContent = isExpanded ? "v" : ">";

  if (!children.length) {
    caret.classList.add("is-empty");
    caret.textContent = ".";
  }

  const label = document.createElement("span");
  label.className = "ontology-label";
  label.textContent = nodeName;

  row.append(caret, label);

  if (relation) {
    const chip = document.createElement("span");
    chip.className = "relation-chip";
    chip.textContent = relation;
    row.appendChild(chip);
  }

  wrapper.appendChild(row);

  if (children.length && includeChildren) {
    const childContainer = document.createElement("div");
    childContainer.className = "ontology-children";
    childContainer.hidden = !isExpanded;

    for (const child of children) {
      if (visibleNodes && !visibleNodes.has(child.name)) {
        continue;
      }

      childContainer.appendChild(
        createOntologyNode(child.name, child.relation, depth + 1, {
          visibleNodes,
          forceExpanded: Boolean(ontologyFilter),
          includeChildren: true,
        }),
      );
    }

    wrapper.appendChild(childContainer);
  }

  return wrapper;
}

function groupOntologyChildren(children) {
  const groups = [];

  for (const child of children) {
    const lastGroup = groups.at(-1);
    if (lastGroup?.relation === child.relation) {
      lastGroup.children.push(child);
    } else {
      groups.push({ relation: child.relation, children: [child] });
    }
  }

  return groups;
}

function createOntologyCluster(relation, children, depth, options = {}) {
  const cluster = document.createElement("div");
  cluster.className = "ontology-cluster";
  cluster.style.setProperty("--depth", depth);

  const heading = document.createElement("div");
  heading.className = "ontology-cluster-heading";
  heading.textContent = relation || "classes";
  cluster.appendChild(heading);

  for (const child of children) {
    cluster.appendChild(createOntologyNode(child.name, child.relation, depth, options));
  }

  return cluster;
}

function createOntologyDrilldownTree() {
  const fragment = document.createDocumentFragment();
  const focusNode = ontologyFocusNode || ontology.root;
  const path = [...getOntologyAncestors(focusNode).reverse(), focusNode];

  path.forEach((nodeName, index) => {
    const relation = index === 0 ? "" : getOntologyRelation(nodeName);
    fragment.appendChild(
      createOntologyNode(nodeName, relation, index, {
        forceExpanded: false,
        includeChildren: false,
        isPath: index < path.length - 1,
      }),
    );
  });

  const children = ontology.childrenByParent.get(focusNode) || [];

  for (const group of groupOntologyChildren(children)) {
    fragment.appendChild(
      createOntologyCluster(group.relation, group.children, path.length, {
        forceExpanded: false,
        includeChildren: false,
      }),
    );
  }

  return fragment;
}

function renderOntologyTree() {
  const shouldAnimate = ontology?.root && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  els.ontologyTree.innerHTML = "";

  if (!ontology?.root) {
    els.ontologyStatus.textContent = "No ontology root found.";
    els.ontologyStatus.className = "ontology-status is-error";
    els.ontologyStatus.hidden = false;
    return;
  }

  const visibleNodes = getVisibleOntologyNodes();

  if (visibleNodes && !visibleNodes.size) {
    els.ontologyStatus.textContent = "No matching ontology classes.";
    els.ontologyStatus.className = "ontology-status";
    els.ontologyStatus.hidden = false;
    return;
  }

  els.ontologyStatus.hidden = true;

  if (ontologyFilter) {
    els.ontologyTree.appendChild(
      createOntologyNode(ontology.root, "", 0, {
        visibleNodes,
        forceExpanded: true,
        includeChildren: true,
      }),
    );
    animateOntologyTree(shouldAnimate);
    return;
  }

  els.ontologyTree.appendChild(createOntologyDrilldownTree());
  animateOntologyTree(shouldAnimate);
}

function animateOntologyTree(shouldAnimate) {
  els.ontologyTree.scrollTo({ top: 0, left: 0, behavior: "auto" });

  if (!shouldAnimate) {
    return;
  }

  els.ontologyTree.classList.remove("is-transitioning");
  void els.ontologyTree.offsetWidth;
  els.ontologyTree.classList.add("is-transitioning");
}

function toggleOntologyNode(nodeName) {
  if (!ontology?.childrenByParent.has(nodeName) || ontologyFilter) {
    return;
  }

  ontologyFocusNode = ontologyFocusNode === nodeName ? ontology.parentByChild.get(nodeName) || ontology.root : nodeName;
  activeOntologyNode = nodeName;
  renderOntologyTree();
}

function setActiveOntologyNode(nodeName) {
  activeOntologyNode = nodeName;
  if (!ontologyFilter && ontology?.childrenByParent.has(nodeName)) {
    ontologyFocusNode = nodeName;
  }
  updateMappingPanel();
  renderOntologyTree();
}

function filterOntologyTree(value) {
  ontologyFilter = value.trim();
  renderOntologyTree();
}

function savePopulation() {
  const entityIndex = entities.findIndex((entity) => entity.id === activeEntityId);
  const populatedIndex = populatedEntities.findIndex((entity) => entity.id === activeEntityId);
  const hasClass = Boolean(activeOntologyNode);

  if ((entityIndex === -1 && populatedIndex === -1) || !hasClass) {
    updateMappingPanel();
    return;
  }

  const [entity] = entityIndex === -1 ? [populatedEntities[populatedIndex]] : entities.splice(entityIndex, 1);
  const populatedEntity = {
    ...entity,
    ontologyClass: activeOntologyNode,
    branchClass: getOntologyBranchClass(activeOntologyNode),
  };

  if (populatedIndex === -1) {
    populatedEntities.push(populatedEntity);
  } else {
    populatedEntities[populatedIndex] = populatedEntity;
  }

  activeEntityId = populatedEntity.id;
  els.entityCount.textContent = formatNumber(entities.length);
  renderEntities(els.entitySearch.value);
  renderCorpus(corpusText);
  setEntityState(activeEntityId, "is-selected", true);
  updateMappingPanel();
}

function buildResultsPayload() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    corpus: corpusPath,
    entityList: entityPath,
    ontology: ontologyPath,
    populatedTerms: populatedEntities.map((entity) => ({
      id: entity.id,
      label: entity.label,
      ontologyClass: entity.ontologyClass,
      branchClass: entity.branchClass,
    })),
  };
}

async function exportResults() {
  const payload = buildResultsPayload();
  const json = JSON.stringify(payload, null, 2);
  const suggestedName = `kaseonto-populated-${new Date().toISOString().slice(0, 10)}.json`;

  if ("showSaveFilePicker" in window) {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: "KaseOnto populated terms JSON",
          accept: { "application/json": [".json"] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    return;
  }

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function restoreResults(payload) {
  const populatedTerms = Array.isArray(payload?.populatedTerms) ? payload.populatedTerms : [];
  const currentEntities = new Map([...entities, ...populatedEntities].map((entity) => [entity.id, entity]));
  const byLabel = new Map([...entities, ...populatedEntities].map((entity) => [entity.label.toLowerCase(), entity]));
  const nextPopulated = [];
  const populatedIds = new Set();

  for (const item of populatedTerms) {
    if (!item?.ontologyClass || !ontology?.nodes.has(item.ontologyClass)) {
      continue;
    }

    const existing = currentEntities.get(item.id) || byLabel.get(String(item.label || "").toLowerCase());
    if (!existing || populatedIds.has(existing.id)) {
      continue;
    }

    populatedIds.add(existing.id);
    nextPopulated.push({
      ...existing,
      ontologyClass: item.ontologyClass,
      branchClass: getOntologyBranchClass(item.ontologyClass),
    });
  }

  populatedEntities = nextPopulated;
  entities = [...currentEntities.values()]
    .filter((entity) => !populatedIds.has(entity.id))
    .map(({ ontologyClass, branchClass, ...entity }) => entity);

  activeEntityId = null;
  activeOntologyNode = ontology?.root || null;
  ontologyFocusNode = ontology?.root || null;
  ontologyFilter = "";
  els.ontologySearch.value = "";
  els.entityCount.textContent = formatNumber(entities.length);
  renderCorpus(corpusText);
  renderEntities(els.entitySearch.value);
  renderOntologyTree();
  updateMappingPanel();
}

async function loadResultsFile(file) {
  if (!file) {
    return;
  }

  const text = await file.text();
  restoreResults(JSON.parse(text));
}

function getVisibleEntities(filter = "") {
  const normalizedFilter = filter.trim().toLowerCase();
  const source = activeTab === "populated" ? populatedEntities : entities;
  return normalizedFilter
    ? source.filter((entity) => entity.label.toLowerCase().includes(normalizedFilter))
    : source;
}

function getEntityById(entityId) {
  return [...entities, ...populatedEntities].find((entity) => entity.id === entityId) || null;
}

function updateMappingPanel() {
  const selectedEntity = getEntityById(activeEntityId);
  const hasClass = Boolean(activeOntologyNode);

  els.selectedTermLabel.textContent = selectedEntity?.label || "None";
  els.selectedClassLabel.textContent = hasClass ? activeOntologyNode : "None";
  els.savePopulation.disabled = !(selectedEntity && hasClass);
}

function setEntityState(entityId, state, enabled) {
  document
    .querySelectorAll(`[data-entity-id="${CSS.escape(entityId)}"]`)
    .forEach((node) => node.classList.toggle(state, enabled));
}

function setHoveredEntity(entityId) {
  if (hoveredEntityId && hoveredEntityId !== activeEntityId) {
    setEntityState(hoveredEntityId, "is-hovered", false);
  }

  hoveredEntityId = entityId;

  if (entityId && entityId !== activeEntityId) {
    setEntityState(entityId, "is-hovered", true);
  }
}

function setActiveEntity(entityId, shouldScroll = false) {
  if (activeEntityId) {
    setEntityState(activeEntityId, "is-selected", false);
  }

  activeEntityId = entityId;

  if (!entityId) {
    return;
  }

  const selectedEntity = getEntityById(entityId);
  const targetTab = selectedEntity?.ontologyClass ? "populated" : "extracted";
  if (activeTab !== targetTab) {
    setActiveTab(targetTab);
  }

  setEntityState(entityId, "is-hovered", false);
  setEntityState(entityId, "is-selected", true);

  const chip = els.entityList.querySelector(`[data-entity-id="${CSS.escape(entityId)}"]`);
  if (chip) {
    chip.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  if (shouldScroll) {
    const firstMatch = els.corpusText.querySelector(`[data-entity-id="${CSS.escape(entityId)}"]`);
    if (firstMatch) {
      firstMatch.scrollIntoView({ block: "center", inline: "nearest" });
    }
  }

  if (selectedEntity?.ontologyClass && ontology?.nodes.has(selectedEntity.ontologyClass)) {
    activeOntologyNode = selectedEntity.ontologyClass;
    ontologyFocusNode = selectedEntity.ontologyClass;
    ontologyFilter = "";
    els.ontologySearch.value = "";
    renderOntologyTree();
  } else if (ontology?.root) {
    activeOntologyNode = ontology.root;
    ontologyFocusNode = ontology.root;
    ontologyFilter = "";
    els.ontologySearch.value = "";
    renderOntologyTree();
  }

  updateMappingPanel();
}

function buildEntityMatches(text) {
  const lowerText = normalizeSearchText(text);
  const occupied = new Uint8Array(text.length);
  const matches = [];
  const sortedEntities = [...entities, ...populatedEntities].sort((a, b) => b.label.length - a.label.length);
  const exactMatchedEntityIds = new Set();

  for (const entity of sortedEntities) {
    const needle = normalizeSearchText(entity.label);
    if (!needle) {
      continue;
    }

    let index = lowerText.indexOf(needle);
    while (index !== -1) {
      const end = index + needle.length;
      let overlaps = false;

      for (let i = index; i < end; i += 1) {
        if (occupied[i]) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps && addMatchIfOpen(matches, occupied, index, end, entity)) {
        exactMatchedEntityIds.add(entity.id);
      }

      index = lowerText.indexOf(needle, index + needle.length);
    }
  }

  for (const entity of sortedEntities) {
    if (exactMatchedEntityIds.has(entity.id)) {
      continue;
    }

    const pattern = buildFlexibleTermPattern(entity);
    if (!pattern) {
      continue;
    }

    for (const match of text.matchAll(pattern)) {
      addMatchIfOpen(matches, occupied, match.index, match.index + match[0].length, entity);
    }
  }

  return matches.sort((a, b) => a.start - b.start);
}

function renderCorpus(text) {
  const fragment = document.createDocumentFragment();
  const matches = buildEntityMatches(text);
  let cursor = 0;

  for (const match of matches) {
    if (match.start > cursor) {
      fragment.append(document.createTextNode(text.slice(cursor, match.start)));
    }

    const span = document.createElement("span");
    span.className = "term-frame corpus-entity";
    if (match.entity.branchClass) {
      span.classList.add(match.entity.branchClass);
    }
    span.dataset.entityId = match.entity.id;
    span.textContent = text.slice(match.start, match.end);
    span.title = match.entity.label;
    span.tabIndex = 0;
    fragment.append(span);
    cursor = match.end;
  }

  if (cursor < text.length) {
    fragment.append(document.createTextNode(text.slice(cursor)));
  }

  els.corpusText.replaceChildren(fragment);
}

function renderEntities(filter = "") {
  const normalizedFilter = filter.trim().toLowerCase();
  const visible = getVisibleEntities(filter);
  const isPopulated = activeTab === "populated";

  if (isPopulated && !visible.length) {
    els.entityList.innerHTML = "";
    els.entityList.hidden = true;
    els.emptyTerms.hidden = false;
    els.emptyTerms.textContent = populatedEntities.length
      ? "No populated terms match this search."
      : "Populated Terms is empty for now.";
    return;
  }

  els.entityList.hidden = false;
  els.emptyTerms.hidden = true;
  els.entityList.innerHTML = "";

  for (const entity of visible) {
    const chip = document.createElement("div");
    chip.className = "term-frame entity-chip";
    if (entity.branchClass) {
      chip.classList.add(entity.branchClass);
    }
    chip.classList.toggle("has-ontology", Boolean(entity.ontologyClass));
    chip.dataset.entityId = entity.id;
    chip.tabIndex = 0;

    if (entity.ontologyClass) {
      chip.title = `Populated as ${entity.ontologyClass}`;
    }

    if (normalizedFilter) {
      const index = entity.label.toLowerCase().indexOf(normalizedFilter);
      const before = entity.label.slice(0, index);
      const match = entity.label.slice(index, index + filter.length);
      const after = entity.label.slice(index + filter.length);
      chip.append(before);
      const mark = document.createElement("mark");
      mark.textContent = match;
      chip.append(mark, after);
    } else {
      chip.textContent = entity.label;
    }

    if (entity.ontologyClass) {
      const classTag = document.createElement("span");
      classTag.className = "entity-class-tag";
      classTag.textContent = "populated";
      chip.appendChild(classTag);
    }

    els.entityList.appendChild(chip);
  }

  if (activeEntityId) {
    setEntityState(activeEntityId, "is-selected", true);
  }

  if (hoveredEntityId && hoveredEntityId !== activeEntityId) {
    setEntityState(hoveredEntityId, "is-hovered", true);
  }
}

function setActiveTab(tabName) {
  activeTab = tabName;

  els.entityTabs.forEach((tab) => {
    const isActive = tab.dataset.tab === tabName;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  els.entitySearch.disabled = false;
  els.entitySearch.placeholder = tabName === "extracted" ? "Search terms" : "Search populated terms";
  renderEntities(els.entitySearch.value);
}

async function loadText(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Cannot load ${path}`);
  }
  return response.text();
}

async function init() {
  try {
    const [corpus, entityText] = await Promise.all([loadText(corpusPath), loadText(entityPath)]);
    corpusText = corpus;
    const lines = corpusText.split(/\r?\n/);

    entities = entityText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((label, index) => ({ id: `entity-${index}`, label }));

    renderCorpus(corpusText);
    els.corpusStatus.textContent = "Loaded";
    els.fileMeta.textContent = `${formatNumber(corpusText.length)} characters`;
    els.wordCount.textContent = formatNumber(countWords(corpusText));
    els.lineCount.textContent = formatNumber(lines.length);
    els.entityCount.textContent = formatNumber(entities.length);
    renderEntities();
  } catch (error) {
    els.corpusStatus.textContent = "Error";
    els.corpusText.textContent =
      "無法讀取資料檔。請用本機伺服器開啟這個頁面，例如在資料夾中執行：python -m http.server 8000";
    console.error(error);
  }

  try {
    const ontologyText = await loadText(ontologyPath);
    ontology = parseOntologyDot(ontologyText);
    ontologyFocusNode = ontology.root;
    activeOntologyNode = ontology.root;
    renderOntologyTree();
  } catch (error) {
    els.ontologyStatus.textContent = "Could not load ontology.";
    els.ontologyStatus.className = "ontology-status is-error";
    els.ontologyStatus.hidden = false;
    console.error(error);
  }
}

els.entitySearch.addEventListener("input", (event) => {
  renderEntities(event.target.value);
});

els.entityTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setActiveTab(tab.dataset.tab);
  });
});

els.ontologySearch.addEventListener("input", (event) => {
  filterOntologyTree(event.target.value);
});

els.ontologyTree.addEventListener("click", (event) => {
  const row = event.target.closest(".ontology-row");
  if (!row) {
    return;
  }

  const nodeName = row.dataset.node;

  if (event.target.closest(".ontology-caret")) {
    toggleOntologyNode(nodeName);
    return;
  }

  setActiveOntologyNode(nodeName);
});

els.ontologyTree.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const row = event.target.closest(".ontology-row");
  if (!row) {
    return;
  }

  event.preventDefault();
  setActiveOntologyNode(row.dataset.node);
});

els.savePopulation.addEventListener("click", () => {
  savePopulation();
});

els.exportResults.addEventListener("click", async () => {
  try {
    await exportResults();
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error(error);
    }
  }
});

els.loadResults.addEventListener("click", () => {
  els.resultsFile.click();
});

els.resultsFile.addEventListener("change", async (event) => {
  try {
    await loadResultsFile(event.target.files?.[0]);
  } catch (error) {
    console.error(error);
    alert("Could not load this results file.");
  } finally {
    event.target.value = "";
  }
});

els.entityList.addEventListener("mouseover", (event) => {
  const chip = event.target.closest("[data-entity-id]");
  if (chip) {
    setHoveredEntity(chip.dataset.entityId);
  }
});

els.entityList.addEventListener("mouseout", (event) => {
  const chip = event.target.closest("[data-entity-id]");
  const nextChip = event.relatedTarget?.closest?.("[data-entity-id]");
  if (chip && chip.dataset.entityId !== nextChip?.dataset.entityId) {
    setHoveredEntity(null);
  }
});

els.entityList.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-entity-id]");
  if (chip) {
    setActiveEntity(chip.dataset.entityId, true);
  }
});

els.entityList.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const chip = event.target.closest("[data-entity-id]");
  if (chip) {
    event.preventDefault();
    setActiveEntity(chip.dataset.entityId, true);
  }
});

els.corpusText.addEventListener("mouseover", (event) => {
  const match = event.target.closest("[data-entity-id]");
  if (match) {
    setHoveredEntity(match.dataset.entityId);
  }
});

els.corpusText.addEventListener("mouseout", (event) => {
  const match = event.target.closest("[data-entity-id]");
  const nextMatch = event.relatedTarget?.closest?.("[data-entity-id]");
  if (match && match.dataset.entityId !== nextMatch?.dataset.entityId) {
    setHoveredEntity(null);
  }
});

els.corpusText.addEventListener("click", (event) => {
  const match = event.target.closest("[data-entity-id]");
  if (match) {
    setActiveEntity(match.dataset.entityId);
  }
});

els.corpusText.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const match = event.target.closest("[data-entity-id]");
  if (match) {
    event.preventDefault();
    setActiveEntity(match.dataset.entityId);
  }
});

els.increaseFont.addEventListener("click", () => {
  readerFontSize = Math.min(readerFontSize + 1, 22);
  document.documentElement.style.setProperty("--reader-font-size", `${readerFontSize}px`);
});

els.decreaseFont.addEventListener("click", () => {
  readerFontSize = Math.max(readerFontSize - 1, 12);
  document.documentElement.style.setProperty("--reader-font-size", `${readerFontSize}px`);
});

init();
