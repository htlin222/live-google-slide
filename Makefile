# Live Google Slide — 開發 / 建置 / 部署快捷指令
#
# 用 `make help` 看所有可用目標。
# 外掛是純 JS（MV3），不需轉譯；「build」= 把 extension/ 打包成 zip，
# 與 CI 的 .github/workflows/release-extension.yml 一致。

# 從 extension/manifest.json 取版本當作 zip 檔名
VERSION  := $(shell node -p "require('./extension/manifest.json').version")
DIST     := dist
ZIP      := $(DIST)/live-google-slide-extension-v$(VERSION).zip
EXT_SRC  := $(wildcard extension/*)

.DEFAULT_GOAL := help

## ── 安裝 ────────────────────────────────────────────────

.PHONY: install
install: ## 安裝 devDependencies（wrangler）
	pnpm install

node_modules: package.json
	pnpm install
	@touch node_modules

## ── 外掛（Chrome MV3）──────────────────────────────────────

.PHONY: build
build: $(ZIP) ## 打包外掛成 dist/*.zip（給上架 / 分發用）

$(ZIP): $(EXT_SRC)
	@mkdir -p $(DIST)
	@rm -f "$(ZIP)"
	cd extension && zip -rq "../$(ZIP)" .
	@echo "Built: $(ZIP)"

.PHONY: lint-ext
lint-ext: ## 用 Node 檢查 manifest.json 是否為合法 JSON
	@node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json')); console.log('manifest.json OK')"

# 開發用：直接載入未封裝的 extension/ 資料夾（不需打包）。
# 用獨立的暫存 profile，不會動到你平常的 Chrome 設定；關掉視窗就乾淨。
# 改完原始碼後，到 chrome://extensions 按該外掛的「重新載入」即可。
CHROME    ?= /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
DEV_PROFILE := $(DIST)/chrome-dev-profile

.PHONY: load
load: lint-ext ## 開一個乾淨的 Chrome，載入未封裝外掛供開發測試
	@mkdir -p $(DEV_PROFILE)
	@echo "載入未封裝外掛：$(PWD)/extension"
	"$(CHROME)" \
		--user-data-dir="$(PWD)/$(DEV_PROFILE)" \
		--load-extension="$(PWD)/extension" \
		--no-first-run --no-default-browser-check \
		"chrome://extensions"

## ── Cloudflare Worker ─────────────────────────────────────

.PHONY: dev
dev: node_modules ## 本機跑 Worker（wrangler dev）
	pnpm run dev

.PHONY: deploy
deploy: node_modules ## 部署 Worker 到 Cloudflare（wrangler deploy）
	pnpm run deploy

.PHONY: gate
gate: ## 提示：用 cf-gate 讓 CF Access 保護 /present（presenter 登入）
	@echo "用 Claude 的 cf-gate 技能保護 presenter 端，例如："
	@echo "  把 live.hsiehting.com/present 放到 CF Access 後面，只允許你的 email"
	@echo "完成後把 team 網域與 application AUD 填進 wrangler.toml 的 [vars]，再 make deploy。"

## ── 雜項 ───────────────────────────────────────────────

.PHONY: version
version: ## 印出目前外掛版本
	@echo $(VERSION)

.PHONY: clean
clean: ## 清掉建置產物（dist/、.wrangler/）
	rm -rf $(DIST) .wrangler

.PHONY: help
help: ## 顯示這份說明
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
