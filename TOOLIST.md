# Toolist 網站

Vercel 繼續部署 Dooby 專案。首頁 `index.html` 是工具總覽，`/dooby` 指向原 Dooby 介紹，`/aiflow` 指向 AI Agent Flow 介紹。`/dooby/app`、隱私權與更新紀錄沿用既有路由，不改動擴充功能與雲端登入。

新增工具時：新增獨立 HTML、首頁工具卡片，必要時補充 vercel.json 的路由；共用 toolist.css。工具頁應列出實際支援平台、版本、下載、安裝與限制。不要放入私人額度、憑證或帳號資料。

AI Agent Flow 0.3.8 下載：Apple Silicon macOS App（ad-hoc 簽章、未公證），及 Scriptable 腳本。部署不會替訪客設定 CLI 或登入帳號。

更新下載時，先驗證安裝包不含 state、usage.json、token 或個人設定，並更新版本、文件與 SHA-256。

## 2026-09-29 更新 / Update

首頁新增清楚的工具入口、卡片來源連結與手機排版。AI Flow 使用獨立深綠色產品頁，含功能、同步流程、安裝、FAQ 與下載。
Home now includes clearer tool entry points, source links and responsive layouts. AI Flow has its own green product landing page with features, sync flow, setup and FAQ.

中英文：toolist-language.js + translations.json；Dooby 介紹與更新記錄共用 toolist-lang 語言偏好。隱私權頁保留完整中英文原文。新增文字時請補翻譯，程式碼內容不翻譯。
Languages: toolist-language.js + translations.json. Dooby landing and changelog share the toolist-lang preference. Privacy policy retains both complete language versions. Translate new interface copy, never the script source.

Mac 主下載改為 AI-Agent-Flow-Mac-0.3.8.dmg。內含 App、Applications 捷徑、中英文 Read-Me。從乾淨暫存目錄建立，以避免 iCloud FinderInfo 影響簽章；驗證掛載後的 App codesign，並更新 SHA256SUMS.txt。DMG 並不等同 Apple 公證。
The primary Mac download is now a DMG with the app, Applications shortcut and bilingual Read-Me. Build from a clean temporary staging directory, verify the mounted app signature and update SHA256SUMS.txt. A DMG does not imply Apple notarization.

GitHub: https://github.com/virus11456/Dooby and https://github.com/virus11456/aiagentflow
No company attribution is shown in the footer.
