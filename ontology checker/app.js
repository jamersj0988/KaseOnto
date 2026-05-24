const ontologyPath = "../ontology/ontology_20.dot";

const defaultOntologyFileName = "ontology_20.dot";
const checkerStateCommentPrefix = "KASEONTO_CHECKER_STATE";

const allowedRelations = new Set(["top sense", "sense", "partial", "feature attribute", "data attribute"]);
const relationSortOrder = new Map([
  ["top sense", 0],
  ["sense", 1],
  ["partial", 2],
  ["feature attribute", 3],
  ["data attribute", 4],
]);
const radialGraphRotation = 215 * (Math.PI / 180);
// ??? v1 UI ??top-level sense ??拙楊??hecker ??畸??堆???branch class??
const ontologyBranchClasses = new Map([
  ["design case", "branch-design-case"],
  ["building", "branch-building"],
  ["event", "branch-event"],
  ["issue", "branch-issue"],
  ["participant", "branch-participant"],
  ["site", "branch-site"],
]);

const state = {
  filter: "checklist",
  query: "",
  classQuery: "",
  selectedId: null,
  selectedClassName: null,
  selectedReviewId: "design-case-top-sense",
  selectedCompletedId: null,
  editingCompletedTargetName: null,
  expandedOntologyNodes: new Set(),
  collapsedOntologyNodes: new Set(),
  graphZoom: 0.78,
  activeTargetIndex: 0,
  pendingRejectTargetName: null,
  rejectReasonDraft: "",
};

let ontology = {
  nodes: [],
  edges: [],
  rootNames: [],
  nodeMap: new Map(),
};
let loadedOntologyName = defaultOntologyFileName;

let issues = [];
let relationReviews = [];
const relationDecisions = new Map();
const relationRejectReasons = new Map();
let targetScrollAnimation = null;
let pendingGraphZoomAnchor = null;
let graphPanDrag = null;

const issueList = document.querySelector("#issue-list");
const issueDetail = document.querySelector("#issue-detail");
const readerCard = document.querySelector(".reader-card");
const issueSearch = document.querySelector("#issue-search");
const classList = document.querySelector("#class-list");
const graphVisualize = document.querySelector("#graph-visualize");
const selectedClassLabel = document.querySelector("#selected-class-label");
const selectedSeverityLabel = document.querySelector("#selected-severity-label");
const checkerStatus = document.querySelector("#checker-status");
const issueCount = document.querySelector("#issue-count");
const classCount = document.querySelector("#class-count");
const checkingModeStatus = document.querySelector("#checking-mode-status");
const backTarget = document.querySelector("#back-target");
const ontologyFileName = document.querySelector("#ontology-file-name");
const loadDotButton = document.querySelector("#load-dot");
const dotFileInput = document.querySelector("#dot-file-input");
const exportDialog = document.querySelector("#export-dialog");
const exportFileNameInput = document.querySelector("#export-file-name");
const exportSaveButton = document.querySelector("#export-save");
const exportCancelButton = document.querySelector("#export-cancel");

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// 右側 Ontology Result 已移除 selected/status DOM，舊同步流程透過 helper 安全略過。
function setOptionalText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function normalizeName(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function loadText(path) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }

  return response.text();
}

function encodeCheckerPayload(payload) {
  // 將 review 狀態轉成 base64，避免 reason 內的換行或引號破壞 DOT 語法。
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

function decodeCheckerPayload(encoded) {
  // LOAD 時還原 Export 放在 DOT comment 裡的 JSON 狀態。
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function extractCheckerState(dotText) {
  // 狀態存在 DOT comment 中；沒有狀態 comment 的一般 DOT 檔會被視為全新 checklist。
  const statePattern = new RegExp(`^\\s*//\\s*${checkerStateCommentPrefix}\\s+([A-Za-z0-9+/=]+)\\s*$`, "m");
  const match = dotText.match(statePattern);

  if (!match) {
    return null;
  }

  try {
    return decodeCheckerPayload(match[1]);
  } catch (error) {
    console.warn("KaseOnto checker state could not be decoded.", error);
    return null;
  }
}

function parseOntologyDot(dotText) {
  const edgePattern = /"([^"]+)"\s*->\s*"([^"]+)"\s*\[label="([^"]+)"\]/g;
  const nodeMap = new Map();
  const edges = [];
  let match;

  function ensureNode(name) {
    if (!nodeMap.has(name)) {
      nodeMap.set(name, {
        name,
        normalized: normalizeName(name),
        parents: [],
        children: [],
      });
    }

    return nodeMap.get(name);
  }

  while ((match = edgePattern.exec(dotText))) {
    const [, parentName, childName, relation] = match;
    const parent = ensureNode(parentName);
    const child = ensureNode(childName);
    const edge = { parent: parentName, child: childName, relation };

    parent.children.push(edge);
    child.parents.push(edge);
    edges.push(edge);
  }

  const nodes = [...nodeMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const rootNames = nodes.filter((node) => node.parents.length === 0).map((node) => node.name);

  return { nodes, edges, rootNames, nodeMap };
}

function getOntologyBranchClass(nodeName) {
  const rootName = ontology.rootNames[0];

  if (!rootName || !nodeName) {
    return "";
  }

  if (nodeName === rootName) {
    return ontologyBranchClasses.get(nodeName) || "";
  }

  let current = nodeName;
  const visited = new Set();

  while (current && !visited.has(current)) {
    visited.add(current);
    const node = ontology.nodeMap.get(current);
    const parent = node?.parents[0]?.parent;

    if (!parent) {
      break;
    }

    if (parent === rootName) {
      return ontologyBranchClasses.get(current) || "";
    }

    current = parent;
  }

  return ontologyBranchClasses.get(current) || "";
}

function getRelationPresentation(relation) {
  const normalizedRelation = normalizeName(relation);
  const relationMap = new Map([
    ["top sense", { label: "has subclass", inverseLabel: "", symbol: "∈" }],
    ["sense", { label: "has subclass", inverseLabel: "is", symbol: "∈" }],
    ["partial", { label: "has part", inverseLabel: "part of", symbol: "⊂" }],
    ["feature attribute", { label: "has feature", inverseLabel: "feature of", symbol: "Σ" }],
    ["data attribute", { label: "has data", inverseLabel: "data of", symbol: "Σ" }],
  ]);

  return relationMap.get(normalizedRelation) || { label: relation || "relation", inverseLabel: "", symbol: "Σ" };
}

function renderRelationBackArrow(relationPresentation) {
  // top sense 不顯示返回箭頭；其他 relation 在小灰字下方顯示 target → source 的 inverse relation。
  if (!relationPresentation.inverseLabel) {
    return "";
  }

  return `
    <span class="relation-back-line"><em>${escapeHtml(relationPresentation.inverseLabel)}</em></span>
    <i class="relation-back-head" aria-hidden="true"></i>
  `;
}

function createIssue({ id, title, severity, className, message, rule, suggestion, snippet }) {
  return {
    id,
    title,
    severity,
    className,
    message,
    rule,
    suggestion,
    snippet,
  };
}

function buildRelationReviews(parsedOntology) {
  return parsedOntology.nodes
    .filter((node) => node.children.length > 0)
    .sort((a, b) => {
      const rootName = parsedOntology.rootNames[0] || "";
      if (a.name === rootName) {
        return -1;
      }

      if (b.name === rootName) {
        return 1;
      }

      return a.name.localeCompare(b.name);
    })
    .map((node) => {
      const targets = [...node.children]
        .sort((a, b) => a.child.localeCompare(b.child))
        .map((edge, index) => ({
          name: edge.child,
          relation: edge.relation,
          isPrimary: index === 0,
        }));

      return {
        id: `source:${normalizeName(node.name)}`,
        source: node.name,
        relation: targets[0]?.relation || "relation",
        title: `${node.name} relation check`,
        targets,
      };
    });
}

function selectedRelationReview() {
  return (
    relationReviews.find((review) => review.id === state.selectedReviewId) || {
      id: "design-case-top-sense",
      source: "design case",
      relation: "top sense",
      title: "Design case relation check",
      targets: [
        { name: "building", relation: "top sense", isPrimary: true },
        { name: "issue", relation: "top sense", isPrimary: false },
        { name: "event", relation: "top sense", isPrimary: false },
      ],
    }
  );
}

function selectRelationReview(reviewId) {
  const review = relationReviews.find((item) => item.id === reviewId);

  if (!review) {
    return;
  }

  state.selectedReviewId = review.id;
  state.selectedCompletedId = null;
  state.editingCompletedTargetName = null;
  state.activeTargetIndex = getNextTargetIndex(review);
  state.selectedClassName = review.targets[state.activeTargetIndex]?.name || review.source;
  render({ animateTarget: true });
}

function returnToCheckMode() {
  const nextReview = getNextCheckModeReview();

  state.filter = "checklist";
  state.selectedCompletedId = null;
  state.editingCompletedTargetName = null;
  state.selectedId = null;

  if (nextReview) {
    state.selectedReviewId = nextReview.id;
    state.activeTargetIndex = getNextTargetIndex(nextReview);
    state.selectedClassName = nextReview.targets[state.activeTargetIndex]?.name || nextReview.source;
    checkerStatus.textContent = "Check mode";
  } else {
    state.selectedClassName = ontology.rootNames[0] || null;
    checkerStatus.textContent = "All left clear";
  }

  render({ animateTarget: true });
}

function selectCompletedTarget(item) {
  const review = relationReviews.find((relationReview) => relationReview.id === item.reviewId);

  if (!review) {
    return;
  }

  const targetIndex = review.targets.findIndex((target) => target.name === item.name);

  if (targetIndex === -1) {
    return;
  }

  state.selectedReviewId = review.id;
  state.selectedCompletedId = item.id;
  state.editingCompletedTargetName = item.name;
  state.pendingRejectTargetName = null;
  state.rejectReasonDraft = "";
  state.filter = item.decision === "approved" ? "accept" : "reject";
  state.activeTargetIndex = targetIndex;
  state.selectedClassName = item.name;
  checkerStatus.textContent = item.isDead ? "Editing dead target" : "Editing completed target";
  renderDetail({ animateTarget: true });
  renderIssues();
  renderClasses();
  updateReviewProgressCount();
  updateBackButtonState();
}

function setRelationDecision(targetName, decision, targetElement = null, options = {}) {
  const review = selectedRelationReview();
  const targetIndex = review.targets.findIndex((target) => target.name === targetName);

  if (targetIndex !== state.activeTargetIndex) {
    checkerStatus.textContent = "Locked";
    return;
  }

  if (decision === "approved") {
    state.pendingRejectTargetName = null;
    state.rejectReasonDraft = "";
  }

  if (state.editingCompletedTargetName === targetName) {
    relationDecisions.set(`${review.id}:${targetName}`, decision);
    if (decision === "approved") {
      expandOntologyResultPath(targetName);
      relationRejectReasons.delete(`${review.id}:${targetName}`);
    } else if (decision === "rejected") {
      relationRejectReasons.set(`${review.id}:${targetName}`, (options.rejectReason || "").trim());
    }
    state.pendingRejectTargetName = null;
    state.rejectReasonDraft = "";
    state.selectedCompletedId = `${review.id}:${targetName}`;
    state.filter = decision === "approved" ? "accept" : "reject";
    checkerStatus.textContent = decision === "approved" ? "Edited approved" : "Edited rejected";
    renderDetail({ animateTarget: false });
    renderIssues();
    renderClasses();
    updateReviewProgressCount();
    updateBackButtonState();
    return;
  }

  if (targetElement && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    targetElement.classList.add("is-exiting");
    targetElement.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    checkerStatus.textContent = decision === "approved" ? "Approving" : "Rejecting";

    targetElement
      .animate(
        [
          { opacity: 1, transform: "scale(1) translateY(0)" },
          { opacity: 0, transform: "scale(0.92) translateY(-8px)" },
        ],
        {
          duration: 220,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "forwards",
        },
      )
      .finished.finally(() => {
          commitRelationDecision(review, targetName, decision, targetIndex, { keepAxisDom: true, rejectReason: options.rejectReason || "" });
      });
    return;
  }

  commitRelationDecision(review, targetName, decision, targetIndex, { rejectReason: options.rejectReason || "" });
}

function showRejectReasonPanel(targetName) {
  const review = selectedRelationReview();
  const reasonKey = `${review.id}:${targetName}`;

  // 按下 reject 時先展開 wrong reason 輸入區，不直接提交 rejected decision。
  state.pendingRejectTargetName = targetName;
  state.rejectReasonDraft = relationRejectReasons.get(reasonKey) || state.rejectReasonDraft || "";
  state.selectedClassName = targetName;
  checkerStatus.textContent = "Wrong reason required";
  renderDetail({ animateTarget: false });
  issueDetail.querySelector(".reject-reason-input")?.focus();
}

function submitRejectReason(targetName) {
  const input = issueDetail.querySelector(`.reject-reason-input[data-target="${CSS.escape(targetName)}"]`);
  const reason = input?.value.trim() || "";

  if (!reason) {
    input?.classList.add("is-invalid");
    checkerStatus.textContent = "Write wrong reason";
    input?.focus();
    return;
  }

  state.rejectReasonDraft = reason;
  const targetElement = input?.closest(".relation-target");
  targetElement?.classList.remove("has-reject-reason");
  input?.closest(".reject-reason-panel")?.remove();
  setRelationDecision(targetName, "rejected", targetElement, { rejectReason: reason });
  renderClasses();
}

function cancelRejectReason() {
  // 取消 reason panel 時只收起輸入區，不改變目前 target 的 pending decision。
  state.pendingRejectTargetName = null;
  state.rejectReasonDraft = "";
  checkerStatus.textContent = "Check mode";
  renderDetail({ animateTarget: false });
}

function commitRelationDecision(review, targetName, decision, targetIndex, options = {}) {
  const { keepAxisDom = false, rejectReason = "" } = options;
  relationDecisions.set(`${review.id}:${targetName}`, decision);
  if (decision === "approved") {
    expandOntologyResultPath(targetName);
    relationRejectReasons.delete(`${review.id}:${targetName}`);
  } else if (decision === "rejected") {
    relationRejectReasons.set(`${review.id}:${targetName}`, rejectReason.trim());
  }
  state.pendingRejectTargetName = null;
  state.rejectReasonDraft = "";
  state.activeTargetIndex = getNextTargetIndex(review, targetIndex);
  state.selectedClassName = review.targets[state.activeTargetIndex]?.name || targetName;
  const selectedReviewStillVisible = getVisibleRelationReviews().some((item) => item.id === state.selectedReviewId);
  const selectedReviewStillHasPending = getReviewPendingCount(review) > 0;
  let shouldRenderDetail = !keepAxisDom || state.activeTargetIndex >= review.targets.length || !selectedReviewStillVisible || !selectedReviewStillHasPending;

  if (!selectedReviewStillVisible || !selectedReviewStillHasPending) {
    const nextReview = getRandomPendingReview(review.id);

    if (nextReview) {
      state.selectedReviewId = nextReview.id;
      state.activeTargetIndex = getNextTargetIndex(nextReview);
      state.selectedClassName = nextReview.targets[state.activeTargetIndex]?.name || nextReview.source;
      checkerStatus.textContent = selectedReviewStillHasPending
        ? decision === "approved" ? "Approved" : "Rejected"
        : "Source complete";
    } else {
      state.selectedClassName = targetName;
      checkerStatus.textContent = "All left clear";
    }

    shouldRenderDetail = true;
  } else {
    checkerStatus.textContent = decision === "approved" ? "Approved" : "Rejected";
  }

  if (shouldRenderDetail || !updateRelationAxisInPlace(review)) {
    renderDetail({ animateTarget: true });
  }
  renderIssues();
  renderClasses();
  updateReviewProgressCount();
  updateBackButtonState();
}

function returnToPreviousTarget() {
  const review = selectedRelationReview();
  const targetIndex = Math.min(state.activeTargetIndex - 1, review.targets.length - 1);
  const target = review.targets[targetIndex];

  if (!target) {
    return;
  }

  relationDecisions.delete(`${review.id}:${target.name}`);
  relationRejectReasons.delete(`${review.id}:${target.name}`);
  state.activeTargetIndex = targetIndex;
  state.selectedClassName = target.name;
  checkerStatus.textContent = "Back";
  render({ animateTarget: true });
}

function getRelationDecision(targetName) {
  const review = selectedRelationReview();
  return relationDecisions.get(`${review.id}:${targetName}`) || "pending";
}

function updateCheckingModeState() {
  const isEditMode = Boolean(state.editingCompletedTargetName);

  readerCard?.classList.toggle("is-edit-mode", isEditMode);

  if (checkingModeStatus) {
    checkingModeStatus.classList.toggle("is-edit-mode", isEditMode);
    checkingModeStatus.lastChild.textContent = isEditMode ? "Edit mode" : "Check mode";
  }
}

function getRelationDecisionForReview(review, targetName) {
  return relationDecisions.get(`${review.id}:${targetName}`) || "pending";
}

function getNextTargetIndex(review, currentIndex = -1) {
  const nextIndex = review.targets.findIndex((target, index) => {
    return index > currentIndex && getRelationDecisionForReview(review, target.name) === "pending";
  });

  if (nextIndex !== -1) {
    return nextIndex;
  }

  const firstPendingIndex = review.targets.findIndex((target) => getRelationDecisionForReview(review, target.name) === "pending");
  return firstPendingIndex === -1 ? review.targets.length : firstPendingIndex;
}

function serializeRelationReviews() {
  return relationReviews.map((review) => ({
    id: review.id,
    source: review.source,
    relation: review.relation,
    targets: review.targets.map((target) => ({
      name: target.name,
      relation: target.relation,
      decision: getRelationDecisionForReview(review, target.name),
      rejectReason: relationRejectReasons.get(`${review.id}:${target.name}`) || "",
    })),
  }));
}

function serializeCheckerState() {
  // Export 只保存使用者判定過的 target，讓未來 LOAD 時仍可依當前 DOT 重建 queue。
  const decisions = [];

  relationReviews.forEach((review) => {
    review.targets.forEach((target) => {
      const key = `${review.id}:${target.name}`;
      const decision = getRelationDecisionForReview(review, target.name);

      if (decision === "pending") {
        return;
      }

      decisions.push({
        source: review.source,
        target: target.name,
        relation: target.relation,
        decision,
        rejectReason: relationRejectReasons.get(key) || "",
      });
    });
  });

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    fileName: loadedOntologyName,
    decisions,
  };
}

function resetReviewState() {
  // 載入新 DOT 前清掉上一份檔案的互動狀態，避免 accept/reject 混到新 ontology。
  relationDecisions.clear();
  relationRejectReasons.clear();
  state.filter = "checklist";
  state.query = "";
  state.classQuery = "";
  state.selectedId = null;
  state.selectedClassName = null;
  state.selectedReviewId = "design-case-top-sense";
  state.selectedCompletedId = null;
  state.editingCompletedTargetName = null;
  state.expandedOntologyNodes.clear();
  state.collapsedOntologyNodes.clear();
  state.activeTargetIndex = 0;
  state.pendingRejectTargetName = null;
  state.rejectReasonDraft = "";
  issueSearch.value = "";
}

function applyCheckerState(checkerState) {
  if (!checkerState?.decisions?.length) {
    return 0;
  }

  let restoredCount = 0;

  checkerState.decisions.forEach((item) => {
    const review = relationReviews.find((candidate) => candidate.source === item.source);
    const target = review?.targets.find((candidate) => candidate.name === item.target);

    if (!review || !target || !["approved", "rejected"].includes(item.decision)) {
      return;
    }

    const key = `${review.id}:${target.name}`;
    relationDecisions.set(key, item.decision);

    if (item.decision === "approved") {
      expandOntologyResultPath(target.name);
      relationRejectReasons.delete(key);
    } else {
      relationRejectReasons.set(key, item.rejectReason || "");
    }

    restoredCount += 1;
  });

  return restoredCount;
}

function applyOntologyDot(dotText, fileName = defaultOntologyFileName) {
  // 所有 DOT 載入路徑共用這裡：解析 graph、重建 review list、再套用 Export 內的狀態。
  const parsedOntology = parseOntologyDot(dotText);
  const checkerState = extractCheckerState(dotText);

  resetReviewState();
  ontology = parsedOntology;
  loadedOntologyName = fileName || defaultOntologyFileName;
  relationReviews = buildRelationReviews(ontology);
  issues = runOntologyChecks(ontology);
  const restoredCount = applyCheckerState(checkerState);
  const nextReview = getNextCheckModeReview() || relationReviews[0];

  state.selectedReviewId = nextReview?.id || state.selectedReviewId;
  state.activeTargetIndex = getNextTargetIndex(selectedRelationReview());
  state.selectedId = issues[0]?.id || null;
  state.selectedClassName =
    selectedRelationReview().targets[state.activeTargetIndex]?.name || selectedRelationReview().source || ontology.rootNames[0] || null;

  if (ontologyFileName) {
    ontologyFileName.textContent = loadedOntologyName;
  }

  checkerStatus.textContent = restoredCount ? `Loaded ${restoredCount} decisions` : "Checked";
}

function getRejectedClassNames() {
  const rejected = new Set();

  relationReviews.forEach((review) => {
    review.targets.forEach((target) => {
      if (getRelationDecisionForReview(review, target.name) === "rejected") {
        rejected.add(normalizeName(target.name));
      }
    });
  });

  return rejected;
}

function isDescendantOfRejectedClass(sourceName, rejectedNames) {
  const visited = new Set();
  const stack = [sourceName];

  while (stack.length) {
    const current = stack.pop();
    const normalized = normalizeName(current);

    if (rejectedNames.has(normalized)) {
      return true;
    }

    if (visited.has(normalized)) {
      continue;
    }

    visited.add(normalized);
    const node = ontology.nodeMap.get(current);
    node?.parents.forEach((edge) => stack.push(edge.parent));
  }

  return false;
}

function isDescendantOfRejectedAncestor(className, rejectedNames) {
  const visited = new Set();
  const node = ontology.nodeMap.get(className);
  const stack = node?.parents.map((edge) => edge.parent) || [];

  while (stack.length) {
    const current = stack.pop();
    const normalized = normalizeName(current);

    if (rejectedNames.has(normalized)) {
      return true;
    }

    if (visited.has(normalized)) {
      continue;
    }

    visited.add(normalized);
    const parentNode = ontology.nodeMap.get(current);
    parentNode?.parents.forEach((edge) => stack.push(edge.parent));
  }

  return false;
}

function getOntologyResultStatus(className) {
  const rejectedNames = getRejectedClassNames();
  let status = "pending";

  relationReviews.forEach((review) => {
    review.targets.forEach((target) => {
      if (target.name !== className) {
        return;
      }

      const decision = getRelationDecisionForReview(review, target.name);

      if (decision === "rejected") {
        status = "rejected";
      } else if (decision === "approved" && status === "pending") {
        status = "approved";
      }
    });
  });

  if (status !== "rejected" && isDescendantOfRejectedAncestor(className, rejectedNames)) {
    return "dead";
  }

  return status;
}

function getOntologyRelationLabel(parentName, childName) {
  return ontology.nodeMap.get(parentName)?.children.find((edge) => edge.child === childName)?.relation || "";
}

function getOntologyResultVisibleNames() {
  const visible = new Set(ontology.rootNames);

  relationReviews.forEach((review) => {
    review.targets.forEach((target) => {
      if (getRelationDecisionForReview(review, target.name) !== "approved") {
        return;
      }

      let current = target.name;

      while (current && !visible.has(current)) {
        visible.add(current);
        current = ontology.nodeMap.get(current)?.parents[0]?.parent || null;
      }
    });
  });

  return visible;
}

function getOntologyResultDisplayStatus(nodeName, visibleResultNames = getOntologyResultVisibleNames()) {
  const rootName = ontology.rootNames[0];
  const status = nodeName === rootName ? "approved" : getOntologyResultStatus(nodeName);

  if (status === "pending" && visibleResultNames.has(nodeName)) {
    return "path";
  }

  return status;
}

function expandOntologyResultPath(nodeName) {
  let current = ontology.nodeMap.get(nodeName)?.parents[0]?.parent || null;

  while (current) {
    state.expandedOntologyNodes.add(current);
    state.collapsedOntologyNodes.delete(current);
    current = ontology.nodeMap.get(current)?.parents[0]?.parent || null;
  }
}

function getVisibleOntologyResultNames() {
  const visibleResultNames = getOntologyResultVisibleNames();

  if (!state.classQuery) {
    return visibleResultNames;
  }

  const visible = new Set();
  const query = state.classQuery.toLowerCase();

  ontology.nodes.forEach((node) => {
    if (!visibleResultNames.has(node.name)) {
      return;
    }

    const parentText = node.parents.map((edge) => edge.parent).join(" ");
    const childText = node.children.map((edge) => edge.child).join(" ");
    const searchable = `${node.name} ${parentText} ${childText}`.toLowerCase();

    if (!searchable.includes(query)) {
      return;
    }

    visible.add(node.name);
    node.parents.forEach((edge) => {
      let current = edge.parent;

      while (current && !visible.has(current)) {
        visible.add(current);
        current = ontology.nodeMap.get(current)?.parents[0]?.parent || null;
      }
    });
  });

  return visible;
}

function getVisibleRelationReviews() {
  const rejectedNames = getRejectedClassNames();
  return relationReviews.filter((review) => !isDescendantOfRejectedClass(review.source, rejectedNames));
}

function isReviewCompleted(review) {
  return review.targets.length > 0 && review.targets.every((target) => getRelationDecisionForReview(review, target.name) !== "pending");
}

function getReviewPendingCount(review) {
  return review.targets.filter((target) => getRelationDecisionForReview(review, target.name) === "pending").length;
}

function getRandomPendingReview(excludedReviewId = null) {
  const candidates = getVisibleRelationReviews().filter((review) => {
    return review.id !== excludedReviewId && getReviewPendingCount(review) > 0;
  });

  if (!candidates.length && excludedReviewId) {
    return getVisibleRelationReviews().find((review) => getReviewPendingCount(review) > 0) || null;
  }

  return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;
}

function getNextCheckModeReview(preferredReviewId = state.selectedReviewId) {
  const preferredReview = getVisibleRelationReviews().find((review) => review.id === preferredReviewId);

  if (preferredReview && getReviewPendingCount(preferredReview) > 0) {
    return preferredReview;
  }

  return getRandomPendingReview(preferredReviewId);
}

function updateBackButtonState() {
  const isEditMode = Boolean(state.editingCompletedTargetName);
  backTarget.disabled = false;
  backTarget.classList.toggle("is-check-mode-return", isEditMode);
  backTarget.textContent = isEditMode ? "Back to Check mode" : "↩";
  backTarget.title = isEditMode ? "Back to Check mode" : "Return to previous target";
}

function updateReviewProgressCount() {
  issueCount.textContent = getCompletedProgressCount().toString();
}

function getCompletedProgressCount() {
  const rejectedNames = getRejectedClassNames();

  // 中上角 Completed 是整體進度：已 accept/reject 或因 ancestor reject 變成 dead 的 target 都算完成。
  return relationReviews.reduce((count, review) => {
    const completedTargets = review.targets.filter((target) => {
      const decision = getRelationDecisionForReview(review, target.name);
      return decision !== "pending" || isDescendantOfRejectedAncestor(target.name, rejectedNames);
    });

    return count + completedTargets.length;
  }, 0);
}

function getReviewListItems() {
  return getVisibleRelationReviews()
    .map((review) => {
      const pendingCount = getReviewPendingCount(review);
      return {
        id: review.id,
        type: "source",
        name: review.source,
        branchClass: getOntologyBranchClass(review.source),
        decision: "pending",
        pendingCount,
        isCurrent: review.id === state.selectedReviewId,
      };
    })
    .filter((item) => item.pendingCount > 0);
}

function getCompletedTargetItems(decisionFilter = null) {
  const rejectedNames = getRejectedClassNames();

  return relationReviews.flatMap((review) => {
    return review.targets
      .filter((target) => {
        const decision = getRelationDecisionForReview(review, target.name);
        return decision !== "pending" && (!decisionFilter || decision === decisionFilter);
      })
      .map((target) => ({
        id: `${review.id}:${target.name}`,
        type: "target",
        reviewId: review.id,
        name: target.name,
        source: review.source,
        branchClass: getOntologyBranchClass(target.name),
        decision: getRelationDecisionForReview(review, target.name),
        isDead: isDescendantOfRejectedAncestor(target.name, rejectedNames),
        pendingCount: 0,
        isCurrent: `${review.id}:${target.name}` === state.selectedCompletedId || target.name === state.selectedClassName,
      }));
  });
}

function findCompletedTargetItem(className, decisionFilter = null) {
  return getCompletedTargetItems(decisionFilter).find((item) => item.name === className) || null;
}

function runOntologyChecks(parsedOntology) {
  const nextIssues = [];
  const seenEdges = new Map();
  const normalizedGroups = new Map();
  const rootName = parsedOntology.rootNames[0] || null;

  parsedOntology.edges.forEach((edge, index) => {
    const edgeKey = `${edge.parent}\u0000${edge.child}\u0000${edge.relation}`;

    if (!seenEdges.has(edgeKey)) {
      seenEdges.set(edgeKey, []);
    }

    seenEdges.get(edgeKey).push(index + 1);

    if (!allowedRelations.has(edge.relation)) {
      nextIssues.push(
        createIssue({
          id: `invalid-relation-${index}`,
          title: "Invalid relation label",
          severity: "critical",
          className: edge.child,
          message: `${edge.relation} is not in the checker relation vocabulary.`,
          rule: "DOT edge labels should use top sense, sense, partial, feature attribute, or data attribute.",
          suggestion: "Rename the relation label or add a deliberate checker rule before using a new relation type.",
          snippet: `"${edge.parent}" -> "${edge.child}" [label="${edge.relation}"]`,
        }),
      );
    }

    if (edge.relation === "top sense" && edge.parent !== rootName) {
      nextIssues.push(
        createIssue({
          id: `nested-top-sense-${index}`,
          title: "Nested top sense relation",
          severity: "warning",
          className: edge.child,
          message: `${edge.child} is marked as top sense under ${edge.parent}.`,
          rule: "top sense should normally connect only the ontology root to its first-level branches.",
          suggestion: "Use sense, partial, feature attribute, or data attribute if this class is not a root branch.",
          snippet: `"${edge.parent}" -> "${edge.child}" [label="top sense"]`,
        }),
      );
    }
  });

  seenEdges.forEach((lineNumbers, edgeKey) => {
    if (lineNumbers.length < 2) {
      return;
    }

    const [parent, child, relation] = edgeKey.split("\u0000");
    nextIssues.push(
      createIssue({
        id: `duplicate-edge-${parent}-${child}-${relation}`,
        title: "Duplicate edge",
        severity: "warning",
        className: child,
        message: `${child} has the same ${relation} edge from ${parent} more than once.`,
        rule: "The same parent, child, and relation triple should appear only once.",
        suggestion: "Remove the repeated DOT edge and keep a single canonical relation.",
        snippet: `Repeated on parsed edge positions: ${lineNumbers.join(", ")}`,
      }),
    );
  });

  if (parsedOntology.rootNames.length !== 1) {
    nextIssues.push(
      createIssue({
        id: "root-count",
        title: "Ontology root is ambiguous",
        severity: "critical",
        className: parsedOntology.rootNames[0] || "Ontology",
        message: `Checker found ${parsedOntology.rootNames.length} root candidates.`,
        rule: "The ontology browser expects exactly one root node for a stable review path.",
        suggestion: "Connect detached branches to the intended root or remove unintended root-level fragments.",
        snippet: parsedOntology.rootNames.join("\n") || "No root node found",
      }),
    );
  }

  parsedOntology.nodes.forEach((node) => {
    if (!normalizedGroups.has(node.normalized)) {
      normalizedGroups.set(node.normalized, []);
    }

    normalizedGroups.get(node.normalized).push(node.name);

    if (node.parents.length > 1) {
      nextIssues.push(
        createIssue({
          id: `multiple-parents-${node.name}`,
          title: "Class has multiple parents",
          severity: "critical",
          className: node.name,
          message: `${node.name} appears under ${node.parents.length} parent classes.`,
          rule: "This checker currently treats the DOT ontology as a single-parent class tree.",
          suggestion: "Keep one structural parent, then represent cross-cutting meaning with a separate relation later.",
          snippet: node.parents.map((edge) => `${edge.parent} -> ${node.name} (${edge.relation})`).join("\n"),
        }),
      );
    }
  });

  normalizedGroups.forEach((names, normalized) => {
    const distinctNames = [...new Set(names)];

    if (distinctNames.length < 2) {
      return;
    }

    nextIssues.push(
      createIssue({
        id: `duplicate-label-${normalized}`,
        title: "Duplicate normalized class label",
        severity: "warning",
        className: distinctNames[0],
        message: `${distinctNames.length} class names collapse to the same lowercase label.`,
        rule: "Class labels should be case-stable so search, export, and review decisions stay predictable.",
        suggestion: "Choose one capitalization style or rename the classes if they represent different concepts.",
        snippet: distinctNames.join("\n"),
      }),
    );
  });

  return nextIssues.sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1 };
    return severityOrder[a.severity] - severityOrder[b.severity] || a.title.localeCompare(b.title);
  });
}

function selectedIssue() {
  if (!issues.length) {
    return null;
  }

  return issues.find((issue) => issue.id === state.selectedId) || issues[0];
}

function filteredReviewItems() {
  const sourceItems =
    state.filter === "accept"
      ? getCompletedTargetItems("approved")
      : state.filter === "reject"
        ? getCompletedTargetItems("rejected")
        : getReviewListItems();

  return sourceItems.filter((item) => {
    const searchable = `${item.name} ${item.source || ""} ${item.decision} ${item.pendingCount}`.toLowerCase();
    return searchable.includes(state.query.toLowerCase());
  });
}

function syncIssueTabs() {
  document.querySelectorAll(".issue-tab").forEach((tab) => {
    const isActive = tab.dataset.filter === state.filter;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
}

function renderIssues() {
  const visibleItems = filteredReviewItems();
  syncIssueTabs();
  issueList.innerHTML = "";

  visibleItems.forEach((item) => {
    const button = document.createElement("button");
    button.className = "issue-chip";
    button.type = "button";
    button.dataset.decision = item.decision;
    button.dataset.reviewId = item.id;
    button.dataset.targetName = item.name;
    button.dataset.dead = item.isDead ? "true" : "false";
    if (item.branchClass) {
      button.classList.add(item.branchClass);
    }
    button.classList.toggle("is-dead", Boolean(item.isDead));
    button.classList.toggle("is-selected", item.isCurrent);
    button.innerHTML = `<span>${escapeHtml(item.name)}</span><small>${escapeHtml(item.isDead ? "dead" : item.type === "target" ? item.decision : `${item.pendingCount} left`)}</small>`;
    button.addEventListener("click", () => {
      if (item.type === "target") {
        selectCompletedTarget(item);
        return;
      }

      selectRelationReview(item.id);
    });
    issueList.append(button);
  });

  if (visibleItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "issue-chip";
    empty.innerHTML =
      state.filter === "accept"
        ? "<span>No accepted targets</span><small>empty</small>"
        : state.filter === "reject"
          ? "<span>No rejected targets</span><small>empty</small>"
        : "<span>No source to check</span><small>clear</small>";
    issueList.append(empty);
  }

  issueList.querySelector(".issue-chip.is-selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function renderDetail(options = {}) {
  const { animateTarget = false } = options;
  const issue = selectedIssue();
  const review = selectedRelationReview();
  const isEditingCompletedTarget = Boolean(state.editingCompletedTargetName);
  updateCheckingModeState();
  const activeTarget =
    (isEditingCompletedTarget ? review.targets.find((target) => target.name === state.editingCompletedTargetName) : null) ||
    review.targets[state.activeTargetIndex] ||
    review.targets.find((target) => getRelationDecision(target.name) === "pending") ||
    review.targets[0];
  const relationLabel = activeTarget?.relation || review.relation;
  const relationPresentation = getRelationPresentation(relationLabel);
  const approvedCount = review.targets.filter((target) => getRelationDecision(target.name) === "approved").length;
  const rejectedCount = review.targets.filter((target) => getRelationDecision(target.name) === "rejected").length;
  const pendingCount = review.targets.length - approvedCount - rejectedCount;
  const sourceBranchClass = getOntologyBranchClass(review.source);
  const connectorBranchClass = getOntologyBranchClass(activeTarget?.name || review.source);
  const hasRejectReasonPanel =
    Boolean(state.pendingRejectTargetName) ||
    Boolean(isEditingCompletedTarget && activeTarget && relationRejectReasons.get(`${review.id}:${activeTarget.name}`));
  const targetMarkup = review.targets
    .map((target, index) => {
      if (isEditingCompletedTarget && target.name !== state.editingCompletedTargetName) {
        return "";
      }

      const decision = getRelationDecision(target.name);
      const isActive = isEditingCompletedTarget ? target.name === state.editingCompletedTargetName : decision === "pending" && index === state.activeTargetIndex;
      const isLocked = !isEditingCompletedTarget && decision === "pending" && index !== state.activeTargetIndex;
      const queueDepth = isLocked ? Math.max(1, index - state.activeTargetIndex) : 0;
      const targetBranchClass = getOntologyBranchClass(target.name);
      const isRejectReasonOpen = isActive && state.pendingRejectTargetName === target.name;
      const existingRejectReason = relationRejectReasons.get(`${review.id}:${target.name}`) || "";
      const shouldShowRejectReason = isEditingCompletedTarget && decision === "rejected" && existingRejectReason && !isRejectReasonOpen;
      const decisionControls = isActive
        ? `
          <div class="relation-target-actions" aria-label="${escapeHtml(target.name)} decision">
            <button class="decision-button is-approve" type="button" data-target="${escapeHtml(target.name)}" data-decision="approved" title="Approve">✓</button>
            <button class="decision-button is-reject" type="button" data-target="${escapeHtml(target.name)}" data-decision="rejected" title="Reject">✕</button>
          </div>
        `
        : "";
      const rejectReasonReadOnlyMarkup = shouldShowRejectReason
        ? `
          <div class="reject-reason-panel is-readonly">
            <label>Wrong reason</label>
            <p>${escapeHtml(existingRejectReason)}</p>
          </div>
        `
        : "";
      const rejectReasonMarkup = isRejectReasonOpen
        ? `
          <div class="reject-reason-panel">
            <label for="reject-reason-${index}">Wrong reason</label>
            <textarea id="reject-reason-${index}" class="reject-reason-input" data-target="${escapeHtml(target.name)}" rows="3" placeholder="Write why this is wrong">${escapeHtml(state.rejectReasonDraft || existingRejectReason)}</textarea>
            <div class="reject-reason-actions">
              <button class="reject-reason-cancel" type="button">Cancel</button>
              <button class="reject-reason-submit" type="button" data-target="${escapeHtml(target.name)}">Confirm reject</button>
            </div>
          </div>
        `
        : "";

      return `
        <div class="relation-target ${targetBranchClass} ${target.isPrimary ? "is-primary" : "is-secondary"} ${isActive ? "is-current" : ""} ${isRejectReasonOpen || shouldShowRejectReason ? "has-reject-reason" : ""} ${isEditingCompletedTarget ? "is-editing-completed" : ""} ${isLocked ? "is-locked" : ""} ${isLocked ? `queue-depth-${Math.min(queueDepth, 3)}` : ""}" data-decision="${decision}" data-target="${escapeHtml(target.name)}">
          <div class="relation-target-main" role="button" tabindex="${isLocked ? "-1" : "0"}" data-target="${escapeHtml(target.name)}" ${isLocked ? "aria-disabled=\"true\"" : ""}>
            <strong>${escapeHtml(target.name)}</strong>
            <span>${isEditingCompletedTarget ? decision : isActive ? "checking" : isLocked ? "left" : decision}</span>
          </div>
          ${decisionControls}
          ${rejectReasonReadOnlyMarkup}
          ${rejectReasonMarkup}
        </div>
      `;
    })
    .join("");

  if (!issue) {
    setOptionalText(selectedClassLabel, state.selectedClassName || "None");
    setOptionalText(selectedSeverityLabel, `${pendingCount} left`);
    issueDetail.innerHTML = `
      <h3>${escapeHtml(review.title)}</h3>
      <div class="detail-meta">
        <span>${pendingCount} left</span>
        <span>${approvedCount} approved</span>
        <span>${rejectedCount} rejected</span>
      </div>
      <section class="relation-review" aria-label="Relation review">
        <div class="relation-source ${sourceBranchClass}">
          <span>Source</span>
          <strong>${escapeHtml(review.source)}</strong>
        </div>
        <div class="relation-connector ${connectorBranchClass}" aria-label="Relation connector">
          <span class="relation-line"></span>
          <strong class="relation-label">
            <b>${escapeHtml(relationPresentation.symbol)}</b>
            <em>${escapeHtml(relationPresentation.label)}</em>
            <small>${escapeHtml(relationLabel)}</small>
          </strong>
          <i></i>
          ${renderRelationBackArrow(relationPresentation)}
        </div>
        <div class="relation-target-panel">
          <div class="relation-target-heading">
            <span>Target axis</span>
            <small>${isEditingCompletedTarget ? "Edit decision" : pendingCount ? "One by one" : "Complete"}</small>
          </div>
          <div class="relation-target-axis ${hasRejectReasonPanel ? "has-reject-reason-open" : ""}">${targetMarkup}</div>
        </div>
      </section>
    `;
    bindRelationReviewEvents({ animateTarget });
    return;
  }

  setOptionalText(selectedClassLabel, state.selectedClassName || issue.className);
  setOptionalText(selectedSeverityLabel, issue.severity);
  issueDetail.innerHTML = `
    <h3>${escapeHtml(issue.title)}</h3>
    <div class="detail-meta">
      <span>${escapeHtml(issue.severity)}</span>
      <span>${escapeHtml(issue.className)}</span>
      <span>${escapeHtml(issue.id)}</span>
    </div>
    <p>${escapeHtml(issue.message)}</p>
    <p><strong>Rule:</strong> ${escapeHtml(issue.rule)}</p>
    <p><strong>Suggestion:</strong> ${escapeHtml(issue.suggestion)}</p>
    <pre><code>${escapeHtml(issue.snippet)}</code></pre>
    <section class="relation-review is-compact" aria-label="Relation review">
      <div class="relation-source ${sourceBranchClass}">
        <span>Source</span>
        <strong>${escapeHtml(review.source)}</strong>
      </div>
      <div class="relation-connector ${connectorBranchClass}" aria-label="Relation connector">
        <span class="relation-line"></span>
        <strong class="relation-label">
          <b>${escapeHtml(relationPresentation.symbol)}</b>
          <em>${escapeHtml(relationPresentation.label)}</em>
          <small>${escapeHtml(relationLabel)}</small>
        </strong>
        <i></i>
        ${renderRelationBackArrow(relationPresentation)}
      </div>
      <div class="relation-target-panel">
        <div class="relation-target-heading">
          <span>Target axis</span>
          <small>${isEditingCompletedTarget ? "Edit decision" : pendingCount ? "One by one" : "Complete"}</small>
        </div>
        <div class="relation-target-axis ${hasRejectReasonPanel ? "has-reject-reason-open" : ""}">${targetMarkup}</div>
      </div>
    </section>
  `;
  bindRelationReviewEvents({ animateTarget });
}

function bindRelationReviewEvents(options = {}) {
  const { animateTarget = false } = options;
  issueDetail.scrollTop = 0;
  const targetAxis = issueDetail.querySelector(".relation-target-axis");
  const currentTarget = issueDetail.querySelector(".relation-target.is-current");

  if (targetAxis && currentTarget) {
    const centeredOffset = currentTarget.offsetTop - targetAxis.offsetTop - (targetAxis.clientHeight - currentTarget.offsetHeight) / 2;
    centerTargetAxis(targetAxis, Math.max(0, centeredOffset), animateTarget);
  }

  issueDetail.querySelectorAll(".relation-target-main").forEach((button) => {
    if (button.dataset.bound === "true") {
      return;
    }

    button.dataset.bound = "true";
    const selectTarget = () => {
      if (button.getAttribute("aria-disabled") === "true") {
        return;
      }

      state.selectedClassName = button.dataset.target;
      renderClasses();
    };

    button.addEventListener("click", () => {
      selectTarget();
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      selectTarget();
    });
  });

  issueDetail.querySelectorAll(".decision-button").forEach((button) => {
    if (button.dataset.bound === "true") {
      return;
    }

    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      if (button.disabled) {
        return;
      }

      const targetName = button.dataset.target;
      state.selectedClassName = targetName;
      if (button.dataset.decision === "rejected") {
        showRejectReasonPanel(targetName);
        return;
      }

      setRelationDecision(targetName, button.dataset.decision, button.closest(".relation-target"));
      renderClasses();
    });
  });

  issueDetail.querySelectorAll(".reject-reason-input").forEach((input) => {
    input.addEventListener("input", () => {
      state.rejectReasonDraft = input.value;
      input.classList.remove("is-invalid");
    });
  });

  issueDetail.querySelectorAll(".reject-reason-submit").forEach((button) => {
    button.addEventListener("click", () => {
      submitRejectReason(button.dataset.target);
    });
  });

  issueDetail.querySelectorAll(".reject-reason-cancel").forEach((button) => {
    button.addEventListener("click", cancelRejectReason);
  });
}

function updateRelationAxisInPlace(review) {
  const targetAxis = issueDetail.querySelector(".relation-target-axis");
  const targetElements = [...issueDetail.querySelectorAll(".relation-target")];
  const activeTarget = review.targets[state.activeTargetIndex];

  if (!targetAxis || !targetElements.length || !activeTarget) {
    return false;
  }

  const approvedCount = review.targets.filter((target) => getRelationDecisionForReview(review, target.name) === "approved").length;
  const rejectedCount = review.targets.filter((target) => getRelationDecisionForReview(review, target.name) === "rejected").length;
  const pendingCount = review.targets.length - approvedCount - rejectedCount;
  const activeRelation = activeTarget.relation || review.relation;
  const relationPresentation = getRelationPresentation(activeRelation);
  const relationLabel = issueDetail.querySelector(".relation-label");
  const headingStatus = issueDetail.querySelector(".relation-target-heading small");
  const detailMeta = issueDetail.querySelectorAll(".detail-meta span");

  if (detailMeta.length >= 3) {
    detailMeta[0].textContent = `${pendingCount} left`;
    detailMeta[1].textContent = `${approvedCount} approved`;
    detailMeta[2].textContent = `${rejectedCount} rejected`;
  }

  if (headingStatus) {
    headingStatus.textContent = pendingCount ? "One by one" : "Complete";
  }

  if (relationLabel) {
    relationLabel.querySelector("b").textContent = relationPresentation.symbol;
    relationLabel.querySelector("em").textContent = relationPresentation.label;
    relationLabel.querySelector("small").textContent = activeRelation;
    const relationConnector = relationLabel.closest(".relation-connector");
    relationConnector?.querySelector(".relation-back-line")?.remove();
    relationConnector?.querySelector(".relation-back-head")?.remove();
    relationConnector?.insertAdjacentHTML("beforeend", renderRelationBackArrow(relationPresentation));
  }

  setOptionalText(selectedClassLabel, state.selectedClassName || activeTarget.name);
  setOptionalText(selectedSeverityLabel, `${pendingCount} left`);

  review.targets.forEach((target, index) => {
    const targetElement = targetElements[index];

    if (!targetElement) {
      return;
    }

    const targetDecision = getRelationDecisionForReview(review, target.name);
    const isActive = targetDecision === "pending" && index === state.activeTargetIndex;
    const isLocked = targetDecision === "pending" && index !== state.activeTargetIndex;
    const queueDepth = isLocked ? Math.max(1, index - state.activeTargetIndex) : 0;
    const targetBranchClass = getOntologyBranchClass(target.name);
    const mainButton = targetElement.querySelector(".relation-target-main");
    const statusLabel = mainButton?.querySelector("span");
    const existingActions = targetElement.querySelector(".relation-target-actions");

    targetElement.className = `relation-target ${targetBranchClass} ${target.isPrimary ? "is-primary" : "is-secondary"} ${isActive ? "is-current" : ""} ${isLocked ? "is-locked" : ""} ${isLocked ? `queue-depth-${Math.min(queueDepth, 3)}` : ""}`;
    targetElement.dataset.decision = targetDecision;

    if (mainButton) {
      mainButton.disabled = isLocked;
      mainButton.dataset.bound = "";
    }

    if (statusLabel) {
      statusLabel.textContent = isActive ? "checking" : isLocked ? "left" : targetDecision;
    }

    existingActions?.remove();

    if (isActive) {
      targetElement.insertAdjacentHTML(
        "beforeend",
        `
          <div class="relation-target-actions" aria-label="${escapeHtml(target.name)} decision">
            <button class="decision-button is-approve" type="button" data-target="${escapeHtml(target.name)}" data-decision="approved" title="Approve">✓</button>
            <button class="decision-button is-reject" type="button" data-target="${escapeHtml(target.name)}" data-decision="rejected" title="Reject">✕</button>
          </div>
        `,
      );
    }
  });

  bindRelationReviewEvents({ animateTarget: true });
  return true;
}

function centerTargetAxis(axis, targetScrollTop, shouldAnimate) {
  if (targetScrollAnimation) {
    cancelAnimationFrame(targetScrollAnimation);
    targetScrollAnimation = null;
  }

  if (!shouldAnimate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    axis.scrollTop = targetScrollTop;
    return;
  }

  const startScrollTop = axis.scrollTop;
  const distance = targetScrollTop - startScrollTop;
  const duration = 520;
  const startTime = performance.now();

  function step(now) {
    const elapsed = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - elapsed, 3);
    axis.scrollTop = startScrollTop + distance * eased;

    if (elapsed < 1) {
      targetScrollAnimation = requestAnimationFrame(step);
      return;
    }

    axis.scrollTop = targetScrollTop;
    targetScrollAnimation = null;
  }

  targetScrollAnimation = requestAnimationFrame(step);
}

function getGraphBranchColor(nodeName, status = "approved") {
  // Graph 顏色沿用 Check List 的 sense branch；非 approved 節點維持灰色。
  if (status !== "approved") {
    return "#7c7c7c";
  }

  const branchClass = getOntologyBranchClass(nodeName);
  const branchColors = {
    "branch-design-case": "#0f766e",
    "branch-building": "#b91c1c",
    "branch-event": "#2d488f",
    "branch-issue": "#8b442a",
    "branch-participant": "#5c3d84",
    "branch-site": "#7c5a18",
  };

  return branchColors[branchClass] || "#44494e";
}

function createSvgElement(name) {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}

function appendGraphNodeShape(group, relation, color) {
  let shape;

  if (relation === "partial") {
    shape = createSvgElement("rect");
    shape.setAttribute("x", "-4.5");
    shape.setAttribute("y", "-4.5");
    shape.setAttribute("width", "9");
    shape.setAttribute("height", "9");
  } else if (relation === "feature attribute") {
    shape = createSvgElement("polygon");
    shape.setAttribute("points", "0,-5.8 5.2,4.2 -5.2,4.2");
  } else if (relation === "data attribute") {
    shape = createSvgElement("polygon");
    shape.setAttribute("points", "0,-5.8 5.8,0 0,5.8 -5.8,0");
  } else {
    shape = createSvgElement("circle");
    shape.setAttribute("r", "4.6");
  }

  shape.classList.add("graph-node-shape");
  shape.setAttribute("fill", color);
  group.appendChild(shape);
}

function buildResultGraphNode(nodeName, visibleResultNames, visibleNames, relation = "top sense", depth = 0) {
  if (!visibleResultNames.has(nodeName) || (visibleNames && !visibleNames.has(nodeName))) {
    return null;
  }

  const node = ontology.nodeMap.get(nodeName);
  const children = (node?.children || [])
    .filter((edge) => visibleResultNames.has(edge.child) && (!visibleNames || visibleNames.has(edge.child)))
    .sort((a, b) => (relationSortOrder.get(a.relation) ?? 99) - (relationSortOrder.get(b.relation) ?? 99))
    .map((edge) => buildResultGraphNode(edge.child, visibleResultNames, visibleNames, edge.relation, depth + 1))
    .filter(Boolean);

  return {
    name: nodeName,
    relation,
    depth,
    children,
    status: getOntologyResultDisplayStatus(nodeName, visibleResultNames),
    leafCount: 1,
  };
}

function getGraphVisibleResultNames(visibleResultNames, visibleNames) {
  // Graph 只畫仍然活著的 result；被 reject 或因 ancestor reject 而 dead 的 class 直接從圖上消失。
  const graphVisibleNames = new Set();

  visibleResultNames.forEach((nodeName) => {
    if (visibleNames && !visibleNames.has(nodeName)) {
      return;
    }

    const resultStatus = getOntologyResultDisplayStatus(nodeName, visibleResultNames);

    if (resultStatus === "rejected" || resultStatus === "dead") {
      return;
    }

    graphVisibleNames.add(nodeName);
  });

  return graphVisibleNames;
}

function measureGraphLeaves(node) {
  if (!node.children.length) {
    node.leafCount = 1;
    return node.leafCount;
  }

  node.leafCount = node.children.reduce((sum, child) => sum + measureGraphLeaves(child), 0);
  return node.leafCount;
}

function assignGraphAngles(node, startAngle, endAngle) {
  if (!node.children.length) {
    node.angle = (startAngle + endAngle) / 2;
    return;
  }

  let cursor = startAngle;
  node.children.forEach((child) => {
    const span = ((endAngle - startAngle) * child.leafCount) / node.leafCount;
    assignGraphAngles(child, cursor, cursor + span);
    cursor += span;
  });
  node.angle = node.children.reduce((sum, child) => sum + child.angle, 0) / node.children.length;
}

function flattenGraphNodes(node, nodes = [], links = []) {
  nodes.push(node);
  node.children.forEach((child) => {
    links.push({ source: node, target: child });
    flattenGraphNodes(child, nodes, links);
  });
  return { nodes, links };
}

function graphPoint(angle, radius) {
  const finalAngle = angle + radialGraphRotation - Math.PI / 2;
  return {
    x: Math.cos(finalAngle) * radius,
    y: Math.sin(finalAngle) * radius,
  };
}

function updateGraphZoom(delta, anchorEvent = null) {
  const previousZoom = state.graphZoom;
  const nextZoom = Math.min(4.2, Math.max(0.38, Number((state.graphZoom + delta).toFixed(2))));

  if (nextZoom === previousZoom) {
    return;
  }

  if (anchorEvent && graphVisualize) {
    const rect = graphVisualize.getBoundingClientRect();

    pendingGraphZoomAnchor = {
      localX: anchorEvent.clientX - rect.left,
      localY: anchorEvent.clientY - rect.top,
      ratio: nextZoom / previousZoom,
      scrollLeft: graphVisualize.scrollLeft,
      scrollTop: graphVisualize.scrollTop,
    };
  }

  state.graphZoom = nextZoom;
  renderClasses();
}

function selectOntologyResultNode(nodeName, resultStatus) {
  state.selectedClassName = nodeName;
  setOptionalText(selectedClassLabel, nodeName);
  setOptionalText(selectedSeverityLabel, resultStatus);
  const completedItem = resultStatus === "approved" ? findCompletedTargetItem(nodeName, "approved") : null;

  if (completedItem) {
    state.filter = "accept";
    state.selectedCompletedId = completedItem.id;
    state.editingCompletedTargetName = completedItem.name;
    state.selectedReviewId = completedItem.reviewId;
    state.activeTargetIndex = relationReviews
      .find((review) => review.id === completedItem.reviewId)
      ?.targets.findIndex((target) => target.name === completedItem.name) ?? state.activeTargetIndex;
    renderDetail({ animateTarget: true });
    renderIssues();
    renderClasses();
    updateBackButtonState();
    return;
  }

  state.selectedCompletedId = null;
  state.editingCompletedTargetName = null;
  renderClasses();
  renderIssues();
  updateBackButtonState();
}

function renderOntologyGraph(visibleNames, visibleResultNames, activeClassName) {
  if (!graphVisualize) {
    return;
  }

  const shouldRestoreScroll = graphVisualize.children.length > 0;
  const previousScrollLeft = graphVisualize.scrollLeft;
  const previousScrollTop = graphVisualize.scrollTop;
  graphVisualize.innerHTML = "";

  if (!ontology.rootNames.length) {
    graphVisualize.innerHTML = `<div class="graph-empty">No ontology result</div>`;
    return;
  }

  const graphVisibleResultNames = getGraphVisibleResultNames(visibleResultNames, visibleNames);
  const rootNode = buildResultGraphNode(ontology.rootNames[0], graphVisibleResultNames, null);

  if (!rootNode) {
    graphVisualize.innerHTML = `<div class="graph-empty">No graph result</div>`;
    return;
  }

  measureGraphLeaves(rootNode);
  assignGraphAngles(rootNode, 0, Math.PI * 2);

  const { nodes, links } = flattenGraphNodes(rootNode);
  const maxDepth = Math.max(1, ...nodes.map((node) => node.depth));
  const width = 2400;
  const height = 2400;
  const margin = 420;
  const radius = Math.min(width, height) / 2 - margin;
  const radiusStep = radius / maxDepth;
  const svg = createSvgElement("svg");
  const linkLayer = createSvgElement("g");
  const nodeLayer = createSvgElement("g");

  svg.setAttribute("viewBox", `${-width / 2} ${-height / 2} ${width} ${height}`);
  svg.setAttribute("width", String(Math.round(width * state.graphZoom)));
  svg.setAttribute("height", String(Math.round(height * state.graphZoom)));
  svg.setAttribute("aria-hidden", "true");
  svg.append(linkLayer, nodeLayer);

  links.forEach((link) => {
    const sourceRadius = link.source.depth * radiusStep;
    const targetRadius = link.target.depth * radiusStep;
    const source = graphPoint(link.source.angle, sourceRadius);
    const target = graphPoint(link.target.angle, targetRadius);
    const controlSource = graphPoint(link.source.angle, (sourceRadius + targetRadius) / 2);
    const controlTarget = graphPoint(link.target.angle, (sourceRadius + targetRadius) / 2);
    const path = createSvgElement("path");

    path.classList.add("graph-link");
    path.setAttribute("stroke", getGraphBranchColor(link.target.name, link.target.status));
    path.setAttribute(
      "d",
      `M${source.x},${source.y} C${controlSource.x},${controlSource.y} ${controlTarget.x},${controlTarget.y} ${target.x},${target.y}`,
    );
    linkLayer.appendChild(path);
  });

  nodes.forEach((node) => {
    const point = graphPoint(node.angle, node.depth * radiusStep);
    const finalAngle = ((node.angle + radialGraphRotation) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const flipLabel = finalAngle > Math.PI;
    const labelAngle = ((node.angle + radialGraphRotation) * 180) / Math.PI - 90 + (flipLabel ? 180 : 0);
    const nodeGroup = createSvgElement("g");
    const label = createSvgElement("text");
    const color = getGraphBranchColor(node.name, node.status);

    nodeGroup.classList.add("graph-node", `is-${node.status}`);
    if (node.name === activeClassName) {
      nodeGroup.classList.add("is-selected");
    }
    nodeGroup.setAttribute("transform", `translate(${point.x},${point.y})`);
    nodeGroup.setAttribute("tabindex", "0");
    nodeGroup.setAttribute("role", "button");
    nodeGroup.setAttribute("aria-label", `${node.name}, ${node.status}`);
    nodeGroup.addEventListener("click", () => selectOntologyResultNode(node.name, node.status));
    nodeGroup.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectOntologyResultNode(node.name, node.status);
      }
    });

    appendGraphNodeShape(nodeGroup, node.relation, color);

    label.classList.add("graph-label");
    // 文字沿著節點相對圓心的法向量旋轉，左半邊翻轉 180 度保持可讀。
    label.setAttribute("transform", `rotate(${labelAngle})`);
    label.setAttribute("dy", "0.32em");
    label.setAttribute("x", flipLabel ? "-8" : "8");
    label.setAttribute("text-anchor", flipLabel ? "end" : "start");
    label.textContent = node.name;
    nodeGroup.appendChild(label);
    nodeLayer.appendChild(nodeGroup);
  });

  graphVisualize.appendChild(svg);
  if (pendingGraphZoomAnchor) {
    graphVisualize.scrollLeft =
      (pendingGraphZoomAnchor.scrollLeft + pendingGraphZoomAnchor.localX) * pendingGraphZoomAnchor.ratio -
      pendingGraphZoomAnchor.localX;
    graphVisualize.scrollTop =
      (pendingGraphZoomAnchor.scrollTop + pendingGraphZoomAnchor.localY) * pendingGraphZoomAnchor.ratio -
      pendingGraphZoomAnchor.localY;
    pendingGraphZoomAnchor = null;
    return;
  }

  graphVisualize.scrollLeft = shouldRestoreScroll
    ? previousScrollLeft
    : Math.max(0, (graphVisualize.scrollWidth - graphVisualize.clientWidth) / 2);
  graphVisualize.scrollTop = shouldRestoreScroll
    ? previousScrollTop
    : Math.max(0, (graphVisualize.scrollHeight - graphVisualize.clientHeight) / 2);
}

function bindGraphViewportControls() {
  if (!graphVisualize) {
    return;
  }

  graphVisualize.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      updateGraphZoom(event.deltaY < 0 ? 0.12 : -0.12, event);
    },
    { passive: false },
  );

  graphVisualize.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  graphVisualize.addEventListener("mousedown", (event) => {
    if (event.button !== 2) {
      return;
    }

    event.preventDefault();
    graphPanDrag = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: graphVisualize.scrollLeft,
      scrollTop: graphVisualize.scrollTop,
    };
    graphVisualize.classList.add("is-panning");
  });
}

function renderClasses() {
  const activeIssue = selectedIssue();
  const activeClassName = state.selectedClassName || activeIssue?.className || null;
  const visibleNames = getVisibleOntologyResultNames();
  const visibleResultNames = getOntologyResultVisibleNames();
  const isSearchMode = Boolean(state.classQuery);

  classList.innerHTML = "";
  setOptionalText(selectedClassLabel, activeClassName || "None");
  setOptionalText(selectedSeverityLabel, activeClassName ? getOntologyResultDisplayStatus(activeClassName, visibleResultNames) : "None");

  if (!ontology.rootNames.length) {
    classList.innerHTML = `<div class="ontology-empty">No ontology result</div>`;
    renderOntologyGraph(visibleNames, visibleResultNames, activeClassName);
    return;
  }

  function createResultNode(nodeName, depth, relation = "") {
    if (!visibleResultNames.has(nodeName)) {
      return null;
    }

    if (visibleNames && !visibleNames.has(nodeName)) {
      return null;
    }

    const node = ontology.nodeMap.get(nodeName);
    const children = node?.children || [];
    const visibleChildren = children
      .filter((edge) => visibleResultNames.has(edge.child) && (!visibleNames || visibleNames.has(edge.child)))
      .sort((a, b) => (relationSortOrder.get(a.relation) ?? 99) - (relationSortOrder.get(b.relation) ?? 99));
    const hasChildren = visibleChildren.length > 0;
    // 已 approve 或 path 狀態的節點才允許展開，search mode 會自動展開所有可見路徑。
    const shouldAutoExpand = isSearchMode || state.expandedOntologyNodes.has(nodeName);
    const isExpanded = shouldAutoExpand && !state.collapsedOntologyNodes.has(nodeName);
    const branchClass = getOntologyBranchClass(nodeName);
    const resultStatus = getOntologyResultDisplayStatus(nodeName, visibleResultNames);
    const wrapper = document.createElement("div");
    const row = document.createElement("div");
    const caret = document.createElement("button");
    const label = document.createElement("span");
    const status = document.createElement("span");

    wrapper.className = "ontology-node";
    wrapper.style.setProperty("--depth", depth);
    wrapper.dataset.node = nodeName;
    if (branchClass) {
      wrapper.classList.add(branchClass);
    }
    wrapper.classList.add(`is-${resultStatus}`);

    row.className = "ontology-row";
    row.classList.toggle("is-selected", nodeName === activeClassName);
    row.dataset.node = nodeName;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-level", String(depth + 1));
    row.setAttribute("aria-selected", String(nodeName === activeClassName));
    if (hasChildren) {
      row.setAttribute("aria-expanded", String(isExpanded));
    }

    caret.className = "ontology-caret";
    caret.type = "button";
    caret.textContent = isExpanded ? "-" : "+";
    caret.classList.toggle("is-collapse", isExpanded);
    caret.disabled = !hasChildren;
    if (!hasChildren) {
      caret.classList.add("is-empty");
      caret.textContent = ".";
      caret.setAttribute("aria-hidden", "true");
    }
    caret.addEventListener("click", (event) => {
      event.stopPropagation();
      if (isExpanded) {
        state.expandedOntologyNodes.delete(nodeName);
        state.collapsedOntologyNodes.add(nodeName);
      } else {
        state.expandedOntologyNodes.add(nodeName);
        state.collapsedOntologyNodes.delete(nodeName);
      }
      renderClasses();
    });

    label.className = "ontology-label";
    label.textContent = nodeName;

    status.className = `result-chip is-${resultStatus}`;
    status.textContent = resultStatus;

    row.append(caret, label);

    if (relation) {
      const chip = document.createElement("span");
      chip.className = "relation-chip";
      chip.textContent = relation;
      row.appendChild(chip);
    }

    row.appendChild(status);
    row.addEventListener("click", () => selectOntologyResultNode(nodeName, resultStatus));

    wrapper.appendChild(row);

    if (hasChildren && isExpanded) {
      const childContainer = document.createElement("div");
      childContainer.className = "ontology-children";
      groupOntologyResultChildren(visibleChildren).forEach((group) => {
        childContainer.appendChild(createOntologyResultCluster(group.relation, group.children, depth + 1));
      });
      wrapper.appendChild(childContainer);
    }

    return wrapper;
  }

  function groupOntologyResultChildren(children) {
    // 依照 v1 ontology browser 的互動方式，把同 relation 的 child classes 收成一個 cluster。
    const groups = [];

    children.forEach((child) => {
      const lastGroup = groups.at(-1);

      if (lastGroup?.relation === child.relation) {
        lastGroup.children.push(child);
        return;
      }

      groups.push({ relation: child.relation, children: [child] });
    });

    return groups;
  }

  function createOntologyResultCluster(relation, children, depth) {
    const cluster = document.createElement("div");
    const heading = document.createElement("div");

    cluster.className = "ontology-cluster";
    cluster.style.setProperty("--depth", depth);
    heading.className = "ontology-cluster-heading";
    heading.textContent = relation || "classes";
    cluster.appendChild(heading);

    children.forEach((edge) => {
      const childNode = createResultNode(edge.child, depth, getOntologyRelationLabel(edge.parent, edge.child));

      if (childNode) {
        cluster.appendChild(childNode);
      }
    });

    return cluster;
  }

  ontology.rootNames.forEach((rootName) => {
    const rootNode = createResultNode(rootName, 0);
    if (rootNode) {
      classList.appendChild(rootNode);
    }
  });

  if (!classList.children.length) {
    classList.innerHTML = `<div class="ontology-empty">No matching ontology results</div>`;
  }

  classList.querySelector(".ontology-row.is-selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  renderOntologyGraph(visibleNames, visibleResultNames, activeClassName);
}

function render(options = {}) {
  const { animateTarget = false } = options;
  renderIssues();
  renderDetail({ animateTarget });
  renderClasses();
  updateReviewProgressCount();
  classCount.textContent = ontology.nodes.length.toString();
  updateBackButtonState();
}

function escapeDotString(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function buildExportDot() {
  // Export 輸出仍是標準 DOT edge，review 狀態另外藏在 Graphviz 可忽略的 comment。
  const stateComment = `// ${checkerStateCommentPrefix} ${encodeCheckerPayload(serializeCheckerState())}`;
  const lines = [`digraph "architecture design case ontology"{`];

  ontology.edges.forEach((edge) => {
    lines.push(`"${escapeDotString(edge.parent)}" -> "${escapeDotString(edge.child)}" [label="${escapeDotString(edge.relation)}"]`);
  });

  lines.push("");
  lines.push(stateComment);
  lines.push("}");

  return `${lines.join("\n")}\n`;
}

function getDefaultExportFileName() {
  // 以目前載入檔名產生預設輸出檔名，避免重複疊出 checked.checked.dot。
  const baseName = (loadedOntologyName.replace(/(?:\.checked)?\.dot$/i, "") || "ontology").replace(/[<>:"/\\|?*]+/g, "-");
  return `${baseName}.checked.dot`;
}

function normalizeExportFileName(value) {
  // 使用者輸入檔名時自動補上 .dot，並移除 Windows 不允許的檔名字元。
  const cleaned = (value || getDefaultExportFileName()).trim().replace(/[<>:"/\\|?*]+/g, "-");
  return /\.dot$/i.test(cleaned) ? cleaned : `${cleaned}.dot`;
}

function downloadExportDot(dotText, fileName) {
  // 不支援系統另存 API 的瀏覽器仍可用一般下載流程輸出 DOT。
  const blob = new Blob([dotText], { type: "text/vnd.graphviz;charset=utf-8" });
  const link = document.createElement("a");

  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function saveExportDot(fileName) {
  const dotText = buildExportDot();

  // 支援 File System Access API 時，讓使用者選擇實際儲存位置與檔名。
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [
        {
          description: "Graphviz DOT file",
          accept: {
            "text/vnd.graphviz": [".dot"],
            "text/plain": [".dot"],
          },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(dotText);
    await writable.close();
    checkerStatus.textContent = "DOT saved";
    return;
  }

  downloadExportDot(dotText, fileName);
  checkerStatus.textContent = "DOT downloaded";
}

function openExportDialog() {
  // 支援原生 save picker 時，EXPORT 直接像 LOAD 一樣跳出系統檔案 UI。
  if (window.showSaveFilePicker) {
    saveExportDot(getDefaultExportFileName());
    return;
  }

  // 不支援原生 save picker 的瀏覽器才退回自訂檔名視窗與一般下載。
  if (!exportDialog || !exportFileNameInput) {
    saveExportDot(getDefaultExportFileName());
    return;
  }

  exportFileNameInput.value = getDefaultExportFileName();

  if (typeof exportDialog.showModal === "function") {
    exportDialog.showModal();
  } else {
    exportDialog.setAttribute("open", "");
  }

  exportFileNameInput.focus();
  exportFileNameInput.select();
}

function closeExportDialog() {
  if (!exportDialog) {
    return;
  }

  if (typeof exportDialog.close === "function") {
    exportDialog.close();
  } else {
    exportDialog.removeAttribute("open");
  }
}

async function confirmExportDialog() {
  const fileName = normalizeExportFileName(exportFileNameInput?.value);

  try {
    await saveExportDot(fileName);
    closeExportDialog();
  } catch (error) {
    if (error.name === "AbortError") {
      checkerStatus.textContent = "Export canceled";
      return;
    }

    checkerStatus.textContent = "Export failed";
    console.error(error);
  }
}

function loadDotFile(file) {
  if (!file) {
    return;
  }

  // FileReader 讓使用者直接載入與 ontology_20.dot 同格式的本機 DOT 檔。
  const reader = new FileReader();

  reader.addEventListener("load", () => {
    try {
      applyOntologyDot(String(reader.result || ""), file.name);
      render({ animateTarget: true });
    } catch (error) {
      checkerStatus.textContent = "Load failed";
      issueDetail.innerHTML = `
        <h3>DOT file could not be loaded</h3>
        <p>${escapeHtml(error.message)}</p>
      `;
    }
  });

  reader.addEventListener("error", () => {
    checkerStatus.textContent = "Load failed";
  });

  checkerStatus.textContent = "Loading file";
  reader.readAsText(file);
}

async function init() {
  try {
    checkerStatus.textContent = "Loading";
    const dotText = await loadText(ontologyPath);
    applyOntologyDot(dotText, defaultOntologyFileName);
    render();
  } catch (error) {
    checkerStatus.textContent = "Load failed";
    issueDetail.innerHTML = `
      <h3>Ontology could not be loaded</h3>
      <p>${escapeHtml(error.message)}</p>
      <p>Please start a local web server from the project root before opening this page.</p>
    `;
  }
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
    if (state.filter === "checklist") {
      returnToCheckMode();
      return;
    }
    render();
  });
});

issueSearch.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderIssues();
});

bindGraphViewportControls();

window.addEventListener("mousemove", (event) => {
  if (!graphPanDrag || !graphVisualize) {
    return;
  }

  event.preventDefault();
  graphVisualize.scrollLeft = graphPanDrag.scrollLeft - (event.clientX - graphPanDrag.startX);
  graphVisualize.scrollTop = graphPanDrag.scrollTop - (event.clientY - graphPanDrag.startY);
});

window.addEventListener("mouseup", () => {
  if (!graphPanDrag || !graphVisualize) {
    return;
  }

  graphPanDrag = null;
  graphVisualize.classList.remove("is-panning");
});

backTarget.addEventListener("click", () => {
  if (state.editingCompletedTargetName) {
    returnToCheckMode();
    return;
  }

  if (state.activeTargetIndex === 0) {
    checkerStatus.textContent = "No previous target";
    return;
  }

  returnToPreviousTarget();
});

loadDotButton?.addEventListener("click", () => {
  dotFileInput?.click();
});

dotFileInput?.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  loadDotFile(file);
  event.target.value = "";
});

document.querySelector("#export-report").addEventListener("click", openExportDialog);

exportSaveButton?.addEventListener("click", confirmExportDialog);

exportCancelButton?.addEventListener("click", closeExportDialog);

exportFileNameInput?.addEventListener("keydown", (event) => {
  // 檔名欄按 Enter 直接進入另存新檔流程，符合一般檔案對話框操作習慣。
  if (event.key === "Enter") {
    event.preventDefault();
    confirmExportDialog();
  }
});

exportDialog?.addEventListener("click", (event) => {
  if (event.target === exportDialog) {
    closeExportDialog();
  }
});

document.querySelector("#mark-resolved")?.addEventListener("click", () => {
  const currentIssue = selectedIssue();

  if (!currentIssue) {
    checkerStatus.textContent = "No issue";
    return;
  }

  issues = issues.filter((issue) => issue.id !== currentIssue.id);
  state.selectedId = issues[0]?.id || null;
  state.selectedClassName = issues[0]?.className || state.selectedClassName;
  checkerStatus.textContent = "Marked";
  render();
});

init();



