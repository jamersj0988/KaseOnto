# AGENTS.md

這份文件是 KaseOnto 專案的「動態記憶」。之後的 agent 在修改專案前應先閱讀這裡，並在專案方向、架構、資料格式或固定工作流程改變時，適時更新本文件。

請保持內容短、準、可用。這裡不是工作日誌，而是讓未來協作的人或 agent 能快速理解專案狀態的長期記憶。

## 專案概況

- KaseOnto 目前是一個靜態網頁版的 corpus 與 entity review 工具。
- 入口檔案是 `index.html`。
- 主要互動邏輯在 `app.js`。
- 樣式在 `styles.css`。
- 根目錄舊版仍可直接讀 `./corpus/` 與 `./entity_list/` 的單檔資料；`versions/v3_ui/` 則改由單一 `data/cases.json` 決定 corpus / entity 檔案來源。
- `versions/v1_current_ui/` 是目前 UI 的 v1 基準快照；根目錄仍是目前主要工作版本。
- `versions/v2_working/` 是 ontology browser 改版工作區，使用白色 click-based radial graph class view。
- `versions/v3_ui/` 是目前主要 UI 工作區；之後若沒有額外指定，前端調整優先以這個版本為準。
- `versions/v3_ui/` 的資料載入改成單一 `data/cases.json` 架構；每個 case 直接在 `cases.json` 內宣告 `original` / `translation` 的 corpus 與 entity 路徑，新增 case 時優先延續這個格式，不要再把路徑寫死在 `app.js`。
- `versions/v3_ui/data/cases.json` 也支援簡短模板格式：用 `caseNumbers` 填數字清單，並在 `template` 裡用 `{case}` 產生 `id`、`label`、corpus/entity 路徑；`app.js`、`tools/build-embedded-data.mjs` 與 `entity_list/check_entity_alignment.py` 都會先展開這個格式。
- `versions/v3_ui/` 的 bilingual term 模型是「同一筆 term 共享一組 extracted / populated 狀態，只帶 `original` / `translation` 兩種 label」；切換 Corpus Preview 的原文 / 中文翻譯只切顯示語言，不可把 term 清單拆成中英兩組。
- `versions/v3_ui/` 的中英文 entity 配對以中文 entity 內括號英文（例如 `中文(English)`）為主鍵；英文 entity 檔維持 term 清單主順序，括號英文找不到時才退回同行 fallback，中文檔多出的 entity 會保留成 `translation-term-*` 供人工檢查。
- `versions/v3_ui/` 的中文 corpus highlight 先匹配完整 `中文(English)` entity label；若完整 label 找不到，先退回匹配括號內完整英文，再匹配括號前中文主詞，避免中文翻譯不同或 compound corpus 文字導致 entity 完全無法框選。
- `versions/v3_ui/` 現在與 checker 一樣採用「開頁先填基本資料」gate：`app.js` 會在 `init()` 前呼叫 `openProfileDialog()`，並先把表單收斂成只有「狀態」與「年分／年級」兩個必填欄位；gate 內另有 `Import` 按鈕可直接載入既有結果檔並關閉 gate，方便只想續改 JSON 的使用者；資料暫存於 `sessionStorage.kaseontoUserProfile`，匯出 JSON 也會附上 `reviewerProfile`，存檔建議檔名格式為 `{狀態}{年分}_case{id}.json`（例如 `研究所0~1年_case98.json`）。
- `ontology checker/` 是 ontology structural QA app，目前維持原生 HTML、CSS、JavaScript，介面風格貼近 v1。
- 目前沒有前端框架、打包工具或建置流程，使用原生 HTML、CSS、JavaScript。
- 因為 app 使用 `fetch()` 讀取本機文字檔，測試時應透過本機 web server 啟動，而不是直接開啟 `index.html`。例如：
  `python -m http.server 8000`。
- `versions/v3_ui/index.html` 會載入 `embedded-data.js` 供 `file://` 直接開啟時使用；若修改 `versions/v3_ui/data/cases.json` 或其引用的 corpus/entity 檔案，且需要支援直接開 HTML，需執行：
  `node versions/v3_ui/tools/build-embedded-data.mjs`。
- 想直接開啟 v3 UI 時，可雙擊 `versions/v3_ui/執行啟動檔.bat`；它會以自身所在資料夾為根目錄，有 Node.js 時先重建 `embedded-data.js`，沒有 Node.js 時直接用現有 embedded 快照開 `index.html`，因此傳給不裝 Node 的使用者前需先由開發端重建好 `embedded-data.js`。
- `versions/v3_ui/entity_list/check_entity_alignment.py` 可檢查 `cases.json` 內各 case 的中英文 entity 是否能用中文括號英文完成配對；執行：
  `python versions/v3_ui/entity_list/check_entity_alignment.py`。

## 動態記憶更新規則

把這份文件當成「專案長期記憶」，不要把它當成每次工作的流水帳。只有當資訊會幫助未來 agent 做出更好判斷時，才需要更新。

遇到以下情況時，應更新本文件：

- 專案目標、產品方向或功能範圍有新的長期決策。
- 架構改變，例如加入前端框架、後端、API、狀態管理、路由、建置流程或測試框架。
- 資料來源、資料格式、檔名規則、編碼、解析方式或資料契約改變。
- 出現新的固定開發指令、測試指令或啟動方式。
- 建立了需要延續的 UI、設計或程式碼風格慣例。
- 發現仍然有效的限制、注意事項或操作 caveat。

以下情況不要更新本文件：

- 單次除錯紀錄。
- 暫時性實驗。
- 個人想法或聊天內容。
- 已完成但不影響未來理解的任務清單。
- 大段 log、錯誤堆疊或產生出來的輸出。

更新時請遵守：

1. 優先修改既有條目，不要重複新增相同資訊。
2. 內容要具體、簡潔。
3. 如果記憶與特定檔案有關，請寫出檔案路徑。
4. 同一次編輯中順手移除或修正過期資訊。
5. 不確定的事情先從程式碼或資料驗證，不要直接寫成事實。

## 目前實作重點

- `app.js` 使用 `Promise.all()` 同時載入 corpus 與 entity 檔案。
- Entity 目前被視為「每行一個 entity」的純文字資料。
- Entity 搜尋是前端 client-side 搜尋，並且不區分大小寫。
- 字體大小按鈕會更新 `document.documentElement` 上的 `--reader-font-size` CSS 變數。
- 目前桌面版 UI 是左右兩欄工作區；螢幕寬度低於 980px 時改為單欄版面。
- `versions/v2_working/app.js` 在沒有 ontology 搜尋文字時，Ontology Browser 先顯示目前 class 的中心圓；點中心圓後，下一層 child classes 會沿 radial layout 展開，children 多時使用多圈比例避免文字擁擠。點 child 會 drill down，parent 以節點連回目前中心圓；graph 可縮放與拖動畫布，搜尋模式仍沿用樹狀結果。
- `ontology checker/app.js` 會從 `../ontology/ontology_20.dot` 載入 DOT ontology，解析 class 與 relation，並產生第一版結構檢查：非法 relation、nested `top sense`、重複 edge、多 root、多 parent、大小寫正規化後重複的 class label。
- `ontology checker/` 右上角 `File` 區塊提供 `LOAD` / `EXPORT`：LOAD 可讀取與 `ontology_20.dot` 同格式的本機 `.dot`；EXPORT 在支援 File System Access API 的瀏覽器中直接開原生 Save UI 讓使用者選擇儲存位置與檔名，輸出 `.checked.dot`；不支援時才退回自訂檔名視窗與一般下載。輸出檔仍保留標準 DOT edge，並用 `// KASEONTO_CHECKER_STATE ...` comment 保存 accept/reject 與 wrong reason，讓之後 LOAD 可還原 review 狀態。若 IMPORT 的 DOT 已含 `// KASEONTO 使用者基本資料` comment 區塊，重新 EXPORT 時需原樣保留該基本資料；目前不再要求使用者填基本資料。
- `ontology checker/` 的 Selected issue 區域畫面標題是 `Check Board`，功能仍以 relation review 為主：預設顯示 `design case - top sense -> target axis`，右側 target class 軸採 sequential review；一次只開放目前 target 的 `✓` / `✕` 判定，按 `✕` 時必須先在下方 wrong reason 輸入框填寫原因並確認後才提交 rejected decision；wrong reason 面板使用清楚實底，不套用玻璃模糊，Reject list 點選 rejected target 進入 edit view 時需顯示該 reason。中間 relation connector 主箭頭表示 source → target；`top sense` 不顯示返回箭頭，其他 relation label 的小灰字下方需有置中的短灰色 target → source 返回箭頭，並插入 inverse relation 文字：`sense` = `is type of`、`partial` = `is part of`、`feature attribute` = `is feature of`、`data attribute` = `is data of`。完成後自動捲到下一個 target，完成的 target 會透明不可見，尚未輪到的 target 會半透明並鎖定。Target 軸不可手動滾動，checking target 需由程式自動置中並對齊 relation arrow 中線；上方 Back 按鍵會撤回上一個判定並回到上一個 target。
- Target 軸需要同時預覽至少兩個 queued pending target；越後面的 pending 透明度越低，且只有 checking target 可以顯示 `✓` / `✕` 判定按鈕。
- `ontology checker/` 上方 list tabs 使用 workflow 分類：`Check List` 顯示 `ontology_20.dot` 中所有有 children、未被 rejected ancestor 隱藏且 `pendingCount > 0` 的 source classes；點 source 後，下方 relation review 檢查該 source 的 children。正常版不抽樣或限制 checklist 筆數；當目前 source 的 pending 變成 0 時，該 source 會從 Check List 消失，Relation Review 會依既有順序跳到下一個仍有 pending 的 source。完成清單拆成 `Accept` 與 `Reject` tabs，分別顯示 approved / rejected targets；完成、Back 撤回或編輯 completed decision 時需同步更新 completed 計數與清單。中上角 `Completed` 數值是整體進度，需計入已 accept/reject 的 target，也需計入因 rejected ancestor 變成 dead 的 pending target。
- 若某個 checking target 被 rejected，該 class 以及它的 descendant source classes 若出現在 `Check List` 中，都要直接從 checklist 隱藏。
- 若某個 target 已在 `Completed`，但之後它的 parent/ancestor class 被 rejected，Completed 中該 target 不刪除，需以灰色 dead 狀態顯示。
- `Completed` 中的 target chip 可點擊進入單筆編輯視圖，只顯示原 source 與該 target，保留目前 `✓`/`✕` decision 狀態，使用者可直接改判定；不要把它退回 checklist queue。
- Checking workflow 分成 `Check mode` 與 `Edit mode`：Check mode 是從 `Check List` 執行 pending review；Edit mode 是從 `Accept` 或 `Reject` 點 completed target 進入單筆編輯。`ontology checker/index.html` 的 `#checking-mode-status` 顯示目前 mode 並放在 Relation Review 右上角；右上浮動 Back 按鈕在 Check mode 顯示 `↩`，在 Edit mode 改成 `Back to Check mode`。回到 Check mode 時必須清除 completed edit 狀態、切回 Check List，優先選目前 source（若仍有 pending），否則依 relation review 順序選下一個 pending source。Edit mode 時 `.reader-card` 需要亮正紅粗框提示正在編輯。
- Relation review 的 target 推進使用 JS easing scroll 與 CSS opacity/scale transition，保留類似智慧型手機 picker 的絲滑上下滑動感；若使用者偏好 reduced motion，需跳過動畫。
- `ontology checker/` 的 source、checking target、Check List、Completed 與 Class Context 會沿用 `versions/v1_current_ui/` 的 top-level sense 色票：`design case`、`building`、`event`、`issue`、`participant`、`site`，子類需往上繼承所屬 branch 顏色。
- `ontology checker/` 右側面板是結果視覺化工作區，內部左右切半：左側 `Graph Visualize` 以原生 SVG 渲染類似 `D3tree.js` 的 radial tree，節點形狀仍由 relation 決定，文字需沿著節點相對圓心的法向量旋轉呈現，左半邊翻轉 180 度保持可讀；graph edge/node 顏色沿用 Check List 的 top-level sense branch 色票；未 approved 的 path 維持灰黑，但 rejected 與 dead class 需直接從 graph 消失。Graph 提供滑鼠滾輪 zoom、右鍵拖曳平移 X/Y，右上只顯示兩行操作提示；graph 容器保留可捲動能力但隱藏原生 scrollbar。右側 `Ontology Result` 使用類似 `versions/v1_current_ui/` ontology browser 的階層 tree 瀏覽互動，children 需依 `sense`、`partial`、`feature attribute`、`data attribute` 等 relation cluster 分組顯示；不提供 search、loaded status、selected/status summary、save/resolve 操作，tree list 頂部需對齊左側 graph frame。Result tree 是 approved-only 結果視覺化：初始只顯示 root `design case` 且不能展開，class 必須被 approved 且其 parent path 已可見，才會逐步出現在樹中。
- 若發生跳級 approve，例如 child 在 parent 尚未被 checking 前先 approved，`Ontology Result` 要畫出 root 到該 approved class 的最短 parent path；path 上尚未被 decision 的 parent class 用灰色 `path` 狀態顯示。
- `Ontology Result`、`Graph Visualize` 與 `Accept` list 共用 selection：點 Result/Graph 中的 approved class 會切到 `Accept`、高亮並捲到對應 completed target，且同步進入 Edit mode、更新右上 Back 按鈕為 `Back to Check mode`；點 Accept target 也要同步高亮 Result tree 與 Graph 中的 class。
- `ontology checker/` 的視覺層級不靠改 layout 尺寸，而靠 panel 權重：`Check Board` 是最高層級，底色較亮、陰影與標題權重較強；`Graph Visualize / Ontology Result` 是第二層，保留中等半透明玻璃感；`Check List / Accept / Reject` 是 queue/status 層，背景與陰影需更淡。

## 已知注意事項

- `index.html` 與 `app.js` 中有部分繁體中文字串看起來像是 mojibake 或編碼錯誤。若修改附近程式碼，請保留既有行為；若要修正畫面文字，應有意識地一次整理，不要繼續複製亂碼。
- `D:\KaseOnto` 目前有 `.git` metadata；修改前仍應檢查工作區是否已有使用者變更。
- Codex Chrome automation 可能使用不同於使用者手動操作的 Chrome profile。若 agent 開 `localhost`/`127.0.0.1` 時遇到 `net::ERR_BLOCKED_BY_CLIENT`，先檢查 Codex Chrome Extension 所在 profile 的 extension/site access、ad blocker allowlist，並確認使用者手動開啟的是同一個 Chrome profile。

## Agent 工作規則
- 再寫下的程式碼中都要附上，中文的annotation來解釋這一段落的程式碼在做甚麼。
- 開始修改專案前，先閱讀本文件。
- 完成有意義的改動前，依照「動態記憶更新規則」判斷是否需要更新本文件。
- 除非使用者要求大改，否則維持目前原生 HTML、CSS、JavaScript 的專案結構。
- 修改時盡量貼近既有檔案風格，避免引入不必要的新抽象或工具。
- 驗證需要 `fetch()` 的 UI 行為時，使用本機 web server。
- 調整 UI 字體、間距或高度後，不只檢查被改的文字，也要全面檢查相鄰元件的 `border`、`border-radius`、`padding`、`width`、`height`/`min-height`、`gap`、`grid`/`flex` 對齊是否被意外影響。
- UI 小改後至少做一次「CSS contract check」：用 `rg`/`Select-String` 檢查目標 selector 與相鄰 selector 的關鍵樣式仍符合預期；如果瀏覽器自動化可用，再補桌面與窄版畫面檢查。
- 若瀏覽器自動化因 profile、extension 或 `ERR_BLOCKED_BY_CLIENT` 無法開 `localhost`，仍要用本機 web server 確認 `index.html` 與 `styles.css` 能以 HTTP 200 載入，並在回覆中說明未完成視覺截圖驗證的原因。
