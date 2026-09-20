# 台股羅盤 V1.2｜一鍵部署版

手機優先的台股收盤後技術面資訊儀表板。前端與後端使用同一個 Node/Express 服務，部署後可直接用手機瀏覽器開啟網址。

## 資料來源
- 臺灣證券交易所 TWSE OpenAPI：上市個股日成交資訊、上市當沖標的、休市/公開資料等。
- TWSE 公開報表 T86：外資、投信、自營商、三大法人買賣超。
- TWSE TWT84U：股價升降幅度/漲停判斷輔助。
- 不使用付費 API、付費資料服務或使用者訂閱資料。

## V1.2 部署方式 A：Vercel
1. 把此資料夾上傳到自己的 GitHub repository。
2. 到 Vercel 建立 New Project，Import 該 repository。
3. Framework 選擇 Other（若自動偵測則維持預設）。
4. 不需要 API Key 或環境變數。
5. Deploy。
6. Vercel 產生 `*.vercel.app` 網址後，手機直接開啟即可。

本專案使用 Node 24.x。Vercel 新專案目前支援 Node 24。

## V1.2 部署方式 B：Render
1. 將專案推到 GitHub。
2. 在 Render 建立 Web Service 並選擇 repository。
3. Build Command：`npm install`
4. Start Command：`npm start`
5. 使用免費方案即可開始測試（實際可用性/限制依 Render 當前方案為準）。

## 本機測試
```bash
npm install
npm start
```
然後開啟：`http://localhost:3000`

## 重要資料規則
- 沒取得資料不填 0；會顯示資料暫時無法取得。
- 非交易日以最近實際交易日為基準。
- 前一日收盤價＝前一交易日收盤價。
- 5 日/20 日均線使用實際交易日收盤價計算。
- 7 日/30 日高低點使用實際交易日最高/最低價計算。
- 日、週 MACD 使用實際歷史收盤資料計算。
- 篩選器：當沖、成交量至少 3000 張、最近交易日外資買超或 0、排除漲停、排除 ETF、日/週 MACD OSC 動能向上，依成交量由高至低取最多 10 檔。

## 更新/延遲
TWSE 資料以證交所實際公開資料更新時間為準；收盤後資料尚未發布時，App 會顯示資料尚未更新/暫時無法取得，而不自行估算。

## API 路由
- `GET /api/status`
- `GET /api/screener?minPrice=20&maxPrice=200&q=`
- `GET /api/stock/:code`
- `GET /api/institutional-ranking`

## 備援
目前以 TWSE 公開資料為唯一核心資料來源，沒有以其他付費資料源作備援。若 TWSE 暫時失效，App 顯示明確錯誤狀態，不用假資料替代。
