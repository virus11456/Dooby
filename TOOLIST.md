# Toolist 網站

Vercel 繼續部署 Dooby 專案。首頁 `index.html` 是工具總覽，`/dooby` 指向原 Dooby 介紹，`/aiflow` 指向 AI Agent Flow 介紹。`/dooby/app`、隱私權與更新紀錄沿用既有路由，不改動擴充功能與雲端登入。

新增工具時：新增獨立 HTML、首頁工具卡片，必要時補充 vercel.json 的路由；共用 toolist.css。工具頁應列出實際支援平台、版本、下載、安裝與限制。不要放入私人額度、憑證或帳號資料。

AI Agent Flow 0.3.8 下載：Apple Silicon macOS App（ad-hoc 簽章、未公證），及 Scriptable 腳本。部署不會替訪客設定 CLI 或登入帳號。

更新下載時，先驗證安裝包不含 state、usage.json、token 或個人設定，並更新版本、文件與 SHA-256。
