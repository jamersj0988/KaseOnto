# AGENTS.md

這份文件是 KaseOnto 專案的「動態記憶」。之後的 agent 在修改專案前應先閱讀這裡，並在專案方向、架構、資料格式或固定工作流程改變時，適時更新本文件。

請保持內容短、準、可用。這裡不是工作日誌，而是讓未來協作的人或 agent 能快速理解專案狀態的長期記憶。

## 專案概況

- KaseOnto 目前是一個靜態網頁版的 corpus 與 entity review 工具。
- 入口檔案是 `index.html`。
- 主要互動邏輯在 `app.js`。
- 樣式在 `styles.css`。
- Corpus 文字目前從 `./corpus/case53_merged.txt` 載入。
- Entity list 目前從 `./entity_list/entity_ids_case53.txt` 載入。
- `versions/v1_current_ui/` 是目前 UI 的 v1 基準快照；根目錄仍是目前主要工作版本。
- `versions/v2_working/` 是 ontology browser 改版工作區，使用白色 click-based radial graph class view。
- `ontology checker/` 是下一個 app 的工作資料夾，目前維持原生 HTML、CSS、JavaScript，介面風格貼近 v1。
- 目前沒有前端框架、打包工具或建置流程，使用原生 HTML、CSS、JavaScript。
- 因為 app 使用 `fetch()` 讀取本機文字檔，測試時應透過本機 web server 啟動，而不是直接開啟 `index.html`。例如：
  `python -m http.server 8000`。

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

## 已知注意事項

- `index.html` 與 `app.js` 中有部分繁體中文字串看起來像是 mojibake 或編碼錯誤。若修改附近程式碼，請保留既有行為；若要修正畫面文字，應有意識地一次整理，不要繼續複製亂碼。
- 建立這份文件時，`D:\KaseOnto` 不是 git repository，沒有 `.git` metadata。
- Codex Chrome automation 可能使用不同於使用者手動操作的 Chrome profile。若 agent 開 `localhost`/`127.0.0.1` 時遇到 `net::ERR_BLOCKED_BY_CLIENT`，先檢查 Codex Chrome Extension 所在 profile 的 extension/site access、ad blocker allowlist，並確認使用者手動開啟的是同一個 Chrome profile。

## Agent 工作規則

- 開始修改專案前，先閱讀本文件。
- 完成有意義的改動前，依照「動態記憶更新規則」判斷是否需要更新本文件。
- 除非使用者要求大改，否則維持目前原生 HTML、CSS、JavaScript 的專案結構。
- 修改時盡量貼近既有檔案風格，避免引入不必要的新抽象或工具。
- 驗證需要 `fetch()` 的 UI 行為時，使用本機 web server。
