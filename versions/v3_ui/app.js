const casesIndexPath = "./data/cases.json";
const ontologyPath = "./ontology/ontology_20.dot";
const embeddedTextAssets = window.__KASEONTO_EMBEDDED_TEXT__ || null;

const els = {
  corpusText: document.querySelector("#corpus-text"),
  corpusTabs: document.querySelectorAll(".corpus-tab"),
  corpusStatus: document.querySelector("#corpus-status"),
  fileName: document.querySelector("#file-name"),
  fileMeta: document.querySelector("#file-meta"),
  entityCount: document.querySelector("#entity-count"),
  populatedCount: document.querySelector("#populated-count"),
  entityList: document.querySelector("#entity-list"),
  entitySearch: document.querySelector("#entity-search"),
  entityTabs: document.querySelectorAll(".entity-tab"),
  emptyTerms: document.querySelector("#empty-terms"),
  ontologySearch: document.querySelector("#ontology-search"),
  ontologyStatus: document.querySelector("#ontology-status"),
  ontologyTree: document.querySelector("#ontology-tree"),
  selectedTermLabel: document.querySelector("#selected-term-label"),
  selectedClassLabel: document.querySelector("#selected-class-label"),
  exportResults: document.querySelector("#export-results"),
  loadResults: document.querySelector("#load-results"),
  resultsFile: document.querySelector("#results-file"),
  caseSelect: document.querySelector("#case-select"),
  increaseFont: document.querySelector("#increase-font"),
  decreaseFont: document.querySelector("#decrease-font"),
  manualGuide: document.querySelector("#manual-guide"),
  manualDialog: document.querySelector("#manual-dialog"),
  manualClose: document.querySelector("#manual-close"),
  profileDialog: document.querySelector("#profile-dialog"),
  profileForm: document.querySelector("#profile-form"),
  profileNameInput: document.querySelector("#profile-name"),
  profileEducationInput: document.querySelector("#profile-education"),
  profileGradeInput: document.querySelector("#profile-grade"),
  profileStudentIdInput: document.querySelector("#profile-student-id"),
  profileError: document.querySelector("#profile-error"),
  profileSubmitButton: document.querySelector("#profile-submit"),
  profileImportButton: null,
};

let activeEntityId = null;
let hoveredEntityId = null;
let activeTab = "extracted";
let activeCorpusTab = "original";
let readerFontSize = 15;
let availableCases = [];
let activeCaseId = "";
let activeCaseData = null;
let ontology = null;
let ontologyFocusNode = null;
let activeOntologyNode = null;
let hasClickedOntologyClass = false;
let ontologyFilter = "";
let ontologyAnimationTimer = null;
let reviewerProfile = null;
let initPromise = null;
const caseDataCache = new Map();
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

function getActiveCorpusText() {
  // 目前畫面上的 corpus 文字一律從 active case 的語言 bucket 取得，避免再把檔案路徑寫死在主程式裡。
  return getActiveLanguageBucket().corpusText || "";
}

function getDefaultLanguageBucket() {
  // 當 case 尚未載入完成時，先提供安全的空 bucket，讓既有 render 流程不會因為 undefined 直接中斷。
  return {
    corpusText: "",
    corpusFileName: "",
    entityFileName: "",
    extractedEntities: [],
    populatedEntities: [],
  };
}

function getActiveLanguageBucket() {
  // 每個 case 會同時帶多語言文本；這個 helper 只負責回傳目前要顯示的 corpus 版本。
  return activeCaseData?.languages?.[activeCorpusTab] || getDefaultLanguageBucket();
}

function getActiveExtractedEntities() {
  // extracted / populated terms 改成 case-level 單一資料集，不再因中英切換複製出第二組 term。
  return activeCaseData?.extractedEntities || [];
}

function getActivePopulatedEntities() {
  return activeCaseData?.populatedEntities || [];
}

function getAllActiveEntities() {
  // term 的判定狀態與 ontology mapping 是跨語言共用的，所以這裡一律回傳同一組 shared terms。
  return [...getActiveExtractedEntities(), ...getActivePopulatedEntities()];
}

function getActiveCaseOption(caseId) {
  return availableCases.find((item) => item.id === caseId) || null;
}

function resolveCaseAssetPath(relativePath) {
  // case 資料檔路徑統一相對於 cases.json 本身，之後只改一份索引檔就能新增或調整 case。
  return new URL(relativePath, new URL(casesIndexPath, window.location.href)).toString();
}

function normalizeAssetLookupKey(path) {
  try {
    const targetUrl = new URL(path, window.location.href);
    const appRootUrl = new URL("./", window.location.href);
    const normalizedPathname = decodeURIComponent(targetUrl.pathname);
    const appRootPathname = decodeURIComponent(appRootUrl.pathname);

    if (targetUrl.origin === appRootUrl.origin && normalizedPathname.startsWith(appRootPathname)) {
      return `./${normalizedPathname.slice(appRootPathname.length)}`;
    }
  } catch (error) {
    console.warn("Failed to normalize asset path.", error);
  }

  return String(path || "");
}

function getEmbeddedText(path) {
  if (!embeddedTextAssets || window.location.protocol !== "file:") {
    return null;
  }

  const lookupKey = normalizeAssetLookupKey(path);
  if (Object.prototype.hasOwnProperty.call(embeddedTextAssets, lookupKey)) {
    return embeddedTextAssets[lookupKey];
  }

  return null;
}

function getFileNameFromPath(filePath) {
  return String(filePath || "").split("/").at(-1) || "";
}

function parseEntityLines(entityText) {
  return entityText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseTranslationEntityLabel(label) {
  // 中文 entity 檔通常是「中文(English)」，這裡保留完整顯示文字，同時額外抽出括號內英文做對照。
  const trimmed = String(label || "").trim();
  const match = trimmed.match(/^(.*?)(?:\s*[\(（]([^)）]+)[\)）])\s*$/);

  if (!match) {
    return {
      displayLabel: trimmed,
      fallbackOriginalLabel: "",
    };
  }

  return {
    displayLabel: trimmed,
    fallbackOriginalLabel: match[2].trim(),
  };
}

function buildCaseTerms(originalEntityText, translationEntityText, caseId) {
  // case 的 term 以英文檔為主鍵，中文檔只提供另一個 display label，避免 extracted/populated 被拆成兩組。
  const originalLines = parseEntityLines(originalEntityText);
  const translationLines = parseEntityLines(translationEntityText);
  const count = Math.max(originalLines.length, translationLines.length);
  const terms = [];

  for (let index = 0; index < count; index += 1) {
    const originalLabel = String(originalLines[index] || "").trim();
    const translationInfo = parseTranslationEntityLabel(translationLines[index] || "");
    const fallbackOriginalLabel = translationInfo.fallbackOriginalLabel;
    const canonicalOriginalLabel = originalLabel || fallbackOriginalLabel;

    if (!canonicalOriginalLabel && !translationInfo.displayLabel) {
      continue;
    }

    terms.push({
      id: `${caseId}:term-${index}`,
      labels: {
        original: canonicalOriginalLabel,
        translation: translationInfo.displayLabel || canonicalOriginalLabel,
      },
    });
  }

  return terms;
}

function getEntityLabel(entity, languageKey = activeCorpusTab) {
  // 所有 term 都帶原文與翻譯兩種 label；畫面上顯示哪一個，由目前 corpus tab 決定。
  return entity?.labels?.[languageKey] || entity?.labels?.original || "";
}

function getEntitySearchTexts(entity) {
  // 搜尋同時比對中英文，讓使用者在任一語言 UI 下都能用另一個語言找到同一筆 term。
  return [entity?.labels?.original || "", entity?.labels?.translation || ""].filter(Boolean);
}

function openManualDialog() {
  // 左上說明書按鈕使用原生 dialog，讓使用者能在不離開 v3 介面的情況下快速查看操作說明。
  if (!els.manualDialog) {
    return;
  }

  if (typeof els.manualDialog.showModal === "function") {
    els.manualDialog.showModal();
  } else {
    els.manualDialog.setAttribute("open", "");
  }
}

function closeManualDialog() {
  // 關閉流程集中在同一個 helper，讓右上角關閉鈕與 backdrop 點擊都走相同行為。
  if (!els.manualDialog) {
    return;
  }

  if (typeof els.manualDialog.close === "function") {
    els.manualDialog.close();
  } else {
    els.manualDialog.removeAttribute("open");
  }
}

function configureProfileFields() {
  // 進站表單只保留「狀態」與「年分／年級」兩個欄位，避免多收姓名與學號。
  const nameField = els.profileNameInput?.closest(".profile-field");
  const studentIdField = els.profileStudentIdInput?.closest(".profile-field");
  const educationField = els.profileEducationInput?.closest(".profile-field");
  const gradeField = els.profileGradeInput?.closest(".profile-field");
  const actions = els.profileDialog?.querySelector(".profile-dialog-actions");

  nameField?.remove();
  studentIdField?.remove();

  if (educationField) {
    educationField.querySelector("span").textContent = "狀態";
    educationField.querySelector("small").textContent = "必填";
  }

  if (gradeField) {
    gradeField.querySelector("span").textContent = "年分／年級";
    gradeField.querySelector("small").textContent = "必填";
  }

  if (els.profileDialog?.querySelector("#profile-dialog-title")) {
    els.profileDialog.querySelector("#profile-dialog-title").textContent = "基本資料填寫";
  }

  if (els.profileDialog?.querySelector(".profile-dialog-copy")) {
    els.profileDialog.querySelector(".profile-dialog-copy").textContent =
      "請先填寫基本資料，這些資料只會用於後續分析，不會公開或提供給第三方。";
  }

  if (els.profileSubmitButton) {
    els.profileSubmitButton.textContent = "開始使用";
  }

  if (actions && !actions.querySelector("#profile-import")) {
    const importButton = document.createElement("button");
    // 基本資料 gate 額外提供 Import，讓只想接續修改既有結果的人能直接載入檔案進入工作區。
    importButton.id = "profile-import";
    importButton.className = "secondary-action profile-import-action";
    importButton.type = "button";
    importButton.textContent = "Import";
    actions.prepend(importButton);
    els.profileImportButton = importButton;
  } else if (actions) {
    els.profileImportButton = actions.querySelector("#profile-import");
  }

  if (els.profileEducationInput) {
    els.profileEducationInput.innerHTML = `
      <option value="">請選擇</option>
      <option value="研究所">研究所</option>
      <option value="大學">大學</option>
      <option value="在職">在職</option>
    `;
  }

  if (els.profileGradeInput) {
    const gradeSelect = document.createElement("select");
    // 年分／年級改成固定選項，讓資料格式保持一致。
    gradeSelect.id = "profile-grade";
    gradeSelect.name = "grade";
    gradeSelect.required = true;
    gradeSelect.innerHTML = `
      <option value="">請選擇</option>
      <option value="0~1年">0~1年</option>
      <option value="1~5年">1~5年</option>
      <option value="5年以上">5年以上</option>
    `;
    els.profileGradeInput.replaceWith(gradeSelect);
    els.profileGradeInput = gradeSelect;
  }
}

function closeProfileDialogGate() {
  // gate 完成或成功匯入既有結果後，共用同一個關閉流程，避免漏掉 body lock 狀態。
  closeProfileDialogGate();
}

function setProfileGateOpen(isOpen) {
  // 基本資料視窗開啟時先鎖住主介面，避免使用者在未填資料前直接操作 v3 review 流程。
  document.body.classList.toggle("is-profile-gate-open", isOpen);
}

function closeProfileDialogGate() {
  // 覆蓋前面誤寫成自我呼叫的版本，正確關閉 gate 並解除 body lock。
  setProfileGateOpen(false);
  if (typeof els.profileDialog?.close === "function") {
    els.profileDialog.close();
  } else {
    els.profileDialog?.removeAttribute("open");
  }
}

function openProfileDialog() {
  // 每次打開頁面都先要求填寫基本資料；若 session 有舊值，只預填不直接跳過。
  if (!els.profileDialog) {
    return;
  }

  try {
    const savedProfile = JSON.parse(sessionStorage.getItem("kaseontoUserProfile") || "null");
    if (savedProfile) {
      if (els.profileNameInput) {
        els.profileNameInput.value = savedProfile.name || "";
      }
      if (els.profileEducationInput) {
        els.profileEducationInput.value = savedProfile.education || "";
      }
      if (els.profileGradeInput) {
        els.profileGradeInput.value = savedProfile.grade || "";
      }
      if (els.profileStudentIdInput) {
        els.profileStudentIdInput.value = savedProfile.studentId || "";
      }
    }
  } catch (error) {
    console.warn("Saved KaseOnto user profile could not be restored.", error);
  }

  if (els.profileError) {
    els.profileError.textContent = "";
  }

  setProfileGateOpen(true);
  if (typeof els.profileDialog.showModal === "function") {
    els.profileDialog.showModal();
  } else {
    els.profileDialog.setAttribute("open", "");
  }

  (els.profileEducationInput || els.profileGradeInput)?.focus();
}

function markProfileValidity() {
  // 狀態與年分／年級列為必要欄位，送出前即時標記缺漏，讓 gate 行為清楚可預期。
  const requiredFields = [els.profileEducationInput, els.profileGradeInput].filter(Boolean);
  const invalidFields = requiredFields.filter((field) => !field.value.trim());

  requiredFields.forEach((field) => {
    field.classList.toggle("is-invalid", invalidFields.includes(field));
  });

  if (els.profileError) {
    els.profileError.textContent = invalidFields.length ? "請先填寫狀態與年分／年級。" : "";
  }

  return invalidFields.length === 0;
}

function submitProfileForm(event) {
  // 送出後把這輪使用者基本資料寫進 session，之後同頁操作與匯出都能沿用同一份資料。
  event?.preventDefault();

  if (!markProfileValidity()) {
    (els.profileEducationInput?.value.trim() ? els.profileGradeInput : els.profileEducationInput)?.focus();
    return;
  }

  const userProfile = {
    name: els.profileNameInput?.value.trim() || "",
    education: els.profileEducationInput?.value.trim() || "",
    grade: els.profileGradeInput?.value.trim() || "",
    studentId: els.profileStudentIdInput?.value.trim() || "",
    submittedAt: new Date().toISOString(),
  };

  reviewerProfile = userProfile;
  window.KASEONTO_USER_PROFILE = userProfile;

  try {
    sessionStorage.setItem("kaseontoUserProfile", JSON.stringify(userProfile));
  } catch (error) {
    console.warn("KaseOnto user profile could not be saved to sessionStorage.", error);
  }

  setProfileGateOpen(false);
  if (typeof els.profileDialog?.close === "function") {
    els.profileDialog.close();
  } else {
    els.profileDialog?.removeAttribute("open");
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFlexibleTermPattern(entity) {
  const label = getEntityLabel(entity);
  const words = label.trim().split(/\s+/);
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
  const {
    visibleNodes = null,
    forceExpanded = false,
    includeChildren = false,
    isPath = false,
    showCaret = true,
    caretSymbol = null,
  } = options;
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
  row.classList.toggle("is-save-ready", hasClickedOntologyClass && activeOntologyNode === nodeName);
  row.classList.toggle("is-match", Boolean(isMatched));
  row.classList.toggle("is-jump-target", isPath && !showCaret);

  if (children.length) {
    row.setAttribute("aria-expanded", String(isExpanded));
  }

  const caret = document.createElement("button");
  caret.className = "ontology-caret";
  caret.type = "button";
  caret.setAttribute("aria-label", `${isExpanded ? "Collapse" : "Open"} ${nodeName}`);
  caret.textContent = caretSymbol || (isExpanded ? "-" : "+");
  caret.classList.toggle("is-collapse", caret.textContent === "-");

  if (!children.length || !showCaret) {
    caret.classList.add("is-empty");
    caret.disabled = true;
    caret.tabIndex = -1;
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = ".";
    caret.classList.remove("is-collapse");
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

  const saveButton = document.createElement("button");
  saveButton.className = "save-population ontology-row-save";
  saveButton.type = "button";
  saveButton.textContent = "Save";
  saveButton.disabled = !activeEntityId;
  saveButton.setAttribute("aria-label", `Save selected term as ${nodeName}`);
  saveButton.addEventListener("click", (event) => {
    event.stopPropagation();
    activeOntologyNode = nodeName;
    hasClickedOntologyClass = true;
    savePopulation();
  });
  row.appendChild(saveButton);

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
    const isCurrentOrParent = index >= path.length - 1;
    fragment.appendChild(
      createOntologyNode(nodeName, relation, index, {
        forceExpanded: isCurrentOrParent,
        includeChildren: false,
        isPath: index < path.length - 1,
        showCaret: isCurrentOrParent,
        caretSymbol: "-",
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
  clearTimeout(ontologyAnimationTimer);

  if (!shouldAnimate) {
    els.ontologyTree.classList.remove("is-transitioning");
    return;
  }

  els.ontologyTree.classList.remove("is-transitioning");
  void els.ontologyTree.offsetWidth;
  els.ontologyTree.classList.add("is-transitioning");
  ontologyAnimationTimer = setTimeout(() => {
    els.ontologyTree.classList.remove("is-transitioning");
  }, 620);
}

function toggleOntologyNode(nodeName) {
  if (!ontology?.childrenByParent.has(nodeName) || ontologyFilter) {
    return;
  }

  ontologyFocusNode = ontologyFocusNode === nodeName ? ontology.parentByChild.get(nodeName) || ontology.root : nodeName;
  activeOntologyNode = nodeName;
  renderOntologyTree();
}

function updateOntologySelectionState() {
  els.ontologyTree.querySelectorAll(".ontology-row").forEach((row) => {
    const isSelected = row.dataset.node === activeOntologyNode;
    row.classList.toggle("is-selected", isSelected);
    row.classList.toggle("is-save-ready", hasClickedOntologyClass && isSelected);
    row.setAttribute("aria-selected", String(isSelected));
  });
}

function setActiveOntologyNode(nodeName) {
  activeOntologyNode = nodeName;
  hasClickedOntologyClass = true;
  updateMappingPanel();
  updateOntologySelectionState();
}

function jumpToOntologyLayer(nodeName) {
  if (!ontology?.nodes.has(nodeName) || ontologyFilter) {
    return;
  }

  activeOntologyNode = nodeName;
  ontologyFocusNode = nodeName;
  hasClickedOntologyClass = false;
  updateMappingPanel();
  renderOntologyTree();
}

function filterOntologyTree(value) {
  ontologyFilter = value.trim();
  renderOntologyTree();
}

function savePopulation() {
  const extractedEntities = getActiveExtractedEntities();
  const populatedEntities = getActivePopulatedEntities();
  const entityIndex = extractedEntities.findIndex((entity) => entity.id === activeEntityId);
  const populatedIndex = populatedEntities.findIndex((entity) => entity.id === activeEntityId);
  const hasClass = Boolean(activeOntologyNode);

  if ((entityIndex === -1 && populatedIndex === -1) || !hasClass) {
    updateMappingPanel();
    return;
  }

  const [entity] = entityIndex === -1 ? [populatedEntities[populatedIndex]] : extractedEntities.splice(entityIndex, 1);
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
  activeOntologyNode = populatedEntity.ontologyClass;
  ontologyFocusNode = populatedEntity.ontologyClass;
  hasClickedOntologyClass = false;
  ontologyFilter = "";
  els.ontologySearch.value = "";
  updateDocumentSummary();
  renderEntities(els.entitySearch.value);
  renderCorpusPanel();
  renderOntologyTree();
  setEntityState(activeEntityId, "is-selected", true);
  updateMappingPanel();
}

function buildResultsPayload() {
  // 匯出的 JSON 連同這輪填寫的基本資料一起保存，方便後續追蹤結果來源。
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    caseId: activeCaseId,
    ontology: ontologyPath,
    reviewerProfile: reviewerProfile,
    populatedTerms: getActivePopulatedEntities().map((entity) => ({
      id: entity.id,
      labels: entity.labels,
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

async function restoreResults(payload) {
  if (payload?.reviewerProfile) {
    // 若結果檔已包含先前填過的基本資料，匯入時直接沿用，讓後續再匯出時資料來源一致。
    reviewerProfile = payload.reviewerProfile;
    window.KASEONTO_USER_PROFILE = payload.reviewerProfile;
    try {
      sessionStorage.setItem("kaseontoUserProfile", JSON.stringify(payload.reviewerProfile));
    } catch (error) {
      console.warn("KaseOnto user profile could not be restored from imported results.", error);
    }
  }

  if (payload?.caseId && payload.caseId !== activeCaseId) {
    const targetCase = getActiveCaseOption(payload.caseId);
    if (!targetCase) {
      throw new Error(`This results file belongs to unknown case ${payload.caseId}.`);
    }

    // 匯入結果時若檔案屬於另一個 case，就先自動切到該 case，再套用 populated 狀態。
    await setActiveCase(targetCase.id);
  }

  // 匯入只還原單一 shared populated term 清單，避免中英文各自保存一份狀態再互相打架。
  const populatedTerms = Array.isArray(payload?.populatedTerms) ? payload.populatedTerms : [];
  const currentEntities = new Map(getAllActiveEntities().map((entity) => [entity.id, entity]));
  const byOriginalLabel = new Map(
    getAllActiveEntities().map((entity) => [getEntityLabel(entity, "original").toLowerCase(), entity]),
  );
  const nextPopulated = [];
  const populatedIds = new Set();

  populatedTerms.forEach((item) => {
    if (!item?.ontologyClass || !ontology?.nodes.has(item.ontologyClass)) {
      return;
    }

    const originalLabel = String(item?.labels?.original || "").toLowerCase();
    const existing = currentEntities.get(item.id) || byOriginalLabel.get(originalLabel);
    if (!existing || populatedIds.has(existing.id)) {
      return;
    }

    populatedIds.add(existing.id);
    nextPopulated.push({
      ...existing,
      ontologyClass: item.ontologyClass,
      branchClass: getOntologyBranchClass(item.ontologyClass),
    });
  });

  activeCaseData.populatedEntities = nextPopulated;
  activeCaseData.extractedEntities = [...currentEntities.values()]
    .filter((entity) => !populatedIds.has(entity.id))
    .map(({ ontologyClass, branchClass, ...entity }) => entity);

  activeEntityId = null;
  activeOntologyNode = ontology?.root || null;
  ontologyFocusNode = ontology?.root || null;
  hasClickedOntologyClass = false;
  ontologyFilter = "";
  els.ontologySearch.value = "";
  updateDocumentSummary();
  renderCorpusPanel();
  renderEntities(els.entitySearch.value);
  renderOntologyTree();
  updateMappingPanel();

  if (els.profileDialog?.open) {
    closeProfileDialogGate();
  }
}

async function loadResultsFile(file) {
  if (!file) {
    return;
  }

  // gate 上的 Import 可能比 init 更早觸發，這裡先等 cases 與預設 case 準備完成，再開始還原結果檔。
  if (initPromise) {
    await initPromise;
  }

  const text = await file.text();
  await restoreResults(JSON.parse(text));
}

function getVisibleEntities(filter = "") {
  const normalizedFilter = filter.trim().toLowerCase();
  const source = activeTab === "populated" ? getActivePopulatedEntities() : getActiveExtractedEntities();

  if (!normalizedFilter) {
    return source;
  }

  return source.filter((entity) =>
    getEntitySearchTexts(entity).some((label) => label.toLowerCase().includes(normalizedFilter)),
  );
}

function getEntityById(entityId) {
  return getAllActiveEntities().find((entity) => entity.id === entityId) || null;
}

function updateMappingPanel() {
  const selectedEntity = getEntityById(activeEntityId);
  const hasClass = Boolean(activeOntologyNode);

  els.selectedTermLabel.textContent = selectedEntity ? getEntityLabel(selectedEntity) : "None";
  els.selectedClassLabel.textContent = hasClass ? activeOntologyNode : "None";
  els.ontologyTree
    .querySelectorAll(".ontology-row-save")
    .forEach((button) => {
      button.disabled = !selectedEntity;
    });
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
    hasClickedOntologyClass = false;
    ontologyFilter = "";
    els.ontologySearch.value = "";
    renderOntologyTree();
  } else if (ontology?.root) {
    activeOntologyNode = ontology.root;
    ontologyFocusNode = ontology.root;
    hasClickedOntologyClass = false;
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
  const sortedEntities = getAllActiveEntities().sort(
    (a, b) => getEntityLabel(b).length - getEntityLabel(a).length,
  );
  const exactMatchedEntityIds = new Set();

  for (const entity of sortedEntities) {
    const needle = normalizeSearchText(getEntityLabel(entity));
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
    span.title = getEntityLabel(match.entity);
    span.tabIndex = 0;
    fragment.append(span);
    cursor = match.end;
  }

  if (cursor < text.length) {
    fragment.append(document.createTextNode(text.slice(cursor)));
  }

  els.corpusText.replaceChildren(fragment);
}

function renderCorpusPanel() {
  // Corpus Preview 的實際內容統一從這個入口刷新，避免日後新增翻譯資料時要分散改多個流程。
  renderCorpus(getActiveCorpusText());
}

function renderEntities(filter = "") {
  const normalizedFilter = filter.trim().toLowerCase();
  const visible = getVisibleEntities(filter);
  const isPopulated = activeTab === "populated";
  const populatedEntities = getActivePopulatedEntities();

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
    const displayLabel = getEntityLabel(entity);
    const counterpartLabel = getEntityLabel(entity, activeCorpusTab === "translation" ? "original" : "translation");
    const chip = document.createElement("div");
    chip.className = "term-frame entity-chip";
    if (entity.branchClass) {
      chip.classList.add(entity.branchClass);
    }
    chip.classList.toggle("has-ontology", Boolean(entity.ontologyClass));
    chip.dataset.entityId = entity.id;
    chip.tabIndex = 0;

    chip.title = counterpartLabel ? `${displayLabel}\n${counterpartLabel}` : displayLabel;
    if (entity.ontologyClass) {
      chip.title = `${chip.title}\nPopulated as ${entity.ontologyClass}`;
    }

    if (normalizedFilter) {
      const index = displayLabel.toLowerCase().indexOf(normalizedFilter);

      if (index >= 0) {
        const before = displayLabel.slice(0, index);
        const match = displayLabel.slice(index, index + filter.length);
        const after = displayLabel.slice(index + filter.length);
        chip.append(before);
        const mark = document.createElement("mark");
        mark.textContent = match;
        chip.append(mark, after);
      } else {
        chip.textContent = displayLabel;
      }
    } else {
      chip.textContent = displayLabel;
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

function setActiveCorpusTab(tabName) {
  activeCorpusTab = tabName;

  els.corpusTabs.forEach((tab) => {
    const isActive = tab.dataset.corpusTab === tabName;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  // 原文與中文翻譯只是同一份內容的兩種顯示，所以這裡保留目前選中的 term 與 ontology mapping。
  updateDocumentSummary();
  renderCorpusPanel();
  renderEntities(els.entitySearch.value);
  if (activeEntityId) {
    setEntityState(activeEntityId, "is-selected", true);
  }
  updateMappingPanel();
}

async function loadText(path) {
  const embeddedText = getEmbeddedText(path);
  if (embeddedText !== null) {
    return embeddedText;
  }

  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Cannot load ${path}`);
  }
  return response.text();
}

async function loadJson(path) {
  // case index 與結果檔都用同一個 JSON loader，之後要擴充欄位時不需要再加另一套讀取流程。
  return JSON.parse(await loadText(path));
}

function updateDocumentSummary() {
  const languageBucket = getActiveLanguageBucket();
  const activeText = getActiveCorpusText();
  const lines = activeText ? activeText.split(/\r?\n/) : [];
  const activeCaseOption = getActiveCaseOption(activeCaseId);
  const languageLabel = activeCorpusTab === "translation" ? "中文翻譯" : "原文";

  // 上方摘要卡跟著目前 case 與語言同步更新，之後新增更多 case 時使用者不會搞不清楚現在看到哪一份資料。
  els.fileName.textContent = languageBucket.corpusFileName || activeCaseOption?.label || "No case loaded";
  els.fileMeta.textContent = activeText
    ? `${activeCaseOption?.label || activeCaseId} · ${languageLabel} · ${formatNumber(activeText.length)} characters`
    : "Preparing document";
  // 摘要卡只保留原始 entity 總數與目前已 populated 數量，讓上方資訊聚焦在標註進度。
  const totalEntities = getActiveExtractedEntities().length + getActivePopulatedEntities().length;
  els.entityCount.textContent = formatNumber(totalEntities);
  els.populatedCount.textContent = formatNumber(getActivePopulatedEntities().length);
}

function populateCaseSelect() {
  // case selector 由 cases.json 動態生成，之後新增 case 只要補資料檔，不必再手改 HTML option。
  if (!els.caseSelect) {
    return;
  }

  els.caseSelect.innerHTML = "";

  availableCases.forEach((caseOption) => {
    const option = document.createElement("option");
    option.value = caseOption.id;
    option.textContent = caseOption.label || caseOption.id;
    els.caseSelect.appendChild(option);
  });

  if (activeCaseId) {
    els.caseSelect.value = activeCaseId;
  }
}

async function loadCaseData(caseOption) {
  if (caseDataCache.has(caseOption.id)) {
    return caseDataCache.get(caseOption.id);
  }

  const originalCorpusUrl = resolveCaseAssetPath(caseOption.languages.original.corpus);
  const originalEntitiesUrl = resolveCaseAssetPath(caseOption.languages.original.entities);
  const translationCorpusUrl = resolveCaseAssetPath(
    caseOption.languages.translation?.corpus || caseOption.languages.original.corpus,
  );
  const translationEntitiesUrl = resolveCaseAssetPath(
    caseOption.languages.translation?.entities || caseOption.languages.original.entities,
  );
  const [originalCorpus, originalEntities, translationCorpus, translationEntities] = await Promise.all([
    loadText(originalCorpusUrl),
    loadText(originalEntitiesUrl),
    loadText(translationCorpusUrl),
    loadText(translationEntitiesUrl),
  ]);
  const sharedTerms = buildCaseTerms(originalEntities, translationEntities, caseOption.id);
  const caseData = {
    id: caseOption.id,
    label: caseOption.label || caseOption.id,
    languages: {
      original: {
        corpusText: originalCorpus,
        corpusFileName: getFileNameFromPath(originalCorpusUrl),
        entityFileName: getFileNameFromPath(originalEntitiesUrl),
      },
      translation: {
        corpusText: translationCorpus,
        corpusFileName: getFileNameFromPath(translationCorpusUrl),
        entityFileName: getFileNameFromPath(translationEntitiesUrl),
      },
    },
    extractedEntities: sharedTerms,
    populatedEntities: [],
  };

  caseDataCache.set(caseOption.id, caseData);
  return caseData;
}

async function setActiveCase(caseId) {
  const caseOption = getActiveCaseOption(caseId);

  if (!caseOption) {
    return;
  }

  els.corpusStatus.textContent = "Loading";
  activeCaseId = caseId;
  activeCaseData = await loadCaseData(caseOption);
  activeEntityId = null;
  hoveredEntityId = null;
  activeTab = "extracted";
  activeCorpusTab = "original";
  ontologyFocusNode = ontology?.root || null;
  activeOntologyNode = ontology?.root || null;
  hasClickedOntologyClass = false;
  ontologyFilter = "";
  if (els.ontologySearch) {
    els.ontologySearch.value = "";
  }
  if (els.entitySearch) {
    els.entitySearch.value = "";
  }

  els.corpusTabs.forEach((tab) => {
    const isActive = tab.dataset.corpusTab === activeCorpusTab;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  els.entityTabs.forEach((tab) => {
    const isActive = tab.dataset.tab === activeTab;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  if (els.caseSelect) {
    els.caseSelect.value = caseId;
  }

  updateDocumentSummary();
  renderCorpusPanel();
  renderEntities();
  renderOntologyTree();
  updateMappingPanel();
  els.corpusStatus.textContent = "Loaded";
}

async function init() {
  try {
    availableCases = await loadJson(casesIndexPath);
    populateCaseSelect();
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
    hasClickedOntologyClass = false;
  } catch (error) {
    els.ontologyStatus.textContent = "Could not load ontology.";
    els.ontologyStatus.className = "ontology-status is-error";
    els.ontologyStatus.hidden = false;
    console.error(error);
  }

  try {
    if (availableCases.length) {
      await setActiveCase(availableCases[0].id);
    }
  } catch (error) {
    els.corpusStatus.textContent = "Error";
    els.corpusText.textContent = "無法載入 case 資料。請確認 cases.json 內的 corpus 與 entity 路徑設定是否正確。";
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

els.corpusTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    // 先把 corpus 分頁互動獨立建好，之後接中文翻譯時可以直接切換資料，不用重做 UI。
    setActiveCorpusTab(tab.dataset.corpusTab);
  });
});

els.caseSelect?.addEventListener("change", async (event) => {
  // case 切換走同一條載入流程，讓未來新增更多 case 時不會再出現散落的 hard-coded 檔名。
  try {
    await setActiveCase(event.target.value);
  } catch (error) {
    els.corpusStatus.textContent = "Error";
    els.corpusText.textContent = "切換 case 失敗，請確認 cases.json 內的資料檔案路徑是否存在。";
    console.error(error);
  }
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

els.ontologyTree.addEventListener("dblclick", (event) => {
  if (event.target.closest(".ontology-caret") || event.target.closest(".ontology-row-save")) {
    return;
  }

  const row = event.target.closest(".ontology-row.is-jump-target");
  if (!row) {
    return;
  }

  jumpToOntologyLayer(row.dataset.node);
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
    // 匯入失敗時把實際原因一起顯示，方便分辨是初始化、case 對不上，還是 JSON 本身有問題。
    alert(`Could not load this results file.\n${error?.message || "Unknown error."}`);
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

els.manualGuide?.addEventListener("click", openManualDialog);

els.manualClose?.addEventListener("click", closeManualDialog);

els.manualDialog?.addEventListener("click", (event) => {
  // 點到 dialog 背景時一樣關閉說明書，維持跟 ontology checker 相近的互動方式。
  if (event.target === els.manualDialog) {
    closeManualDialog();
  }
});

configureProfileFields();

els.profileForm?.addEventListener("submit", submitProfileForm);

els.profileSubmitButton?.addEventListener("click", submitProfileForm);

els.profileImportButton?.addEventListener("click", () => {
  // gate 上的 Import 直接沿用既有結果檔 input，讓使用者可跳過手填資料、直接接續編修。
  els.resultsFile?.click();
});

els.profileForm?.addEventListener("keydown", (event) => {
  // 基本資料表單支援 Enter 送出，讓進站流程維持順手。
  if (event.key === "Enter") {
    submitProfileForm(event);
  }
});

els.profileDialog?.addEventListener("cancel", (event) => {
  // 基本資料是必要 gate，因此避免用 ESC 直接關閉跳過。
  event.preventDefault();
});

[els.profileEducationInput, els.profileGradeInput].forEach((field) => {
  field?.addEventListener("input", () => {
    // 使用者補齊欄位後立刻清掉 invalid 樣式與提示，減少卡關感。
    field.classList.remove("is-invalid");
    if (els.profileError) {
      els.profileError.textContent = "";
    }
  });
});

openProfileDialog();
initPromise = init();
