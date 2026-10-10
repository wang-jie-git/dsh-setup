/**
 * @wang-jie-git/dsh-memory-ai — Client-side config page
 *
 * 通过自定义 RPC 端点 (/memory-config/read/write/health) 读写配置。
 */
window.__ModuleLoader__.load({
	id: "@wang-jie-git/dsh-memory-ai",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const { useState, useEffect, useCallback } = React;

		/** 调用自定义 RPC 端点 */
		async function rpc(endpoint, args = {}) {
			const apiBase = (globalThis.location?.origin) || "http://127.0.0.1:3080";
			const res = await globalThis.fetch(`${apiBase}/memory-config/${endpoint}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "client-request",
					rpcId: crypto.randomUUID(),
					method: endpoint,
					payload: args
				})
			});
			const data = await res.json();
			if (data.result?.ok) return data.result.value;
			throw new Error(data.result?.error?.message || `RPC ${endpoint} failed`);
		}

		/** 行内样式 */
		const style = {
			wrap: { padding: "20px 24px", maxWidth: "640px" },
			h2: { margin: "0 0 6px 0", fontSize: "18px", fontWeight: 700 },
			section: { marginBottom: "20px", padding: "16px", border: "1px solid #eee", borderRadius: "8px", background: "#fafafa" },
			sectionTitle: { margin: "0 0 10px 0", fontSize: "14px", fontWeight: 600 },
			row: { marginBottom: "14px" },
			label: { display: "block", marginBottom: "4px", fontWeight: 600, fontSize: "13px", color: "#333" },
			input: { width: "100%", padding: "8px 12px", border: "1px solid #ddd", borderRadius: "6px", fontSize: "14px", boxSizing: "border-box", background: "#fff" },
			select: { width: "auto", minWidth: "200px", padding: "8px 12px", border: "1px solid #ddd", borderRadius: "6px", fontSize: "14px", background: "#fff" },
			btn: { padding: "8px 24px", border: "none", borderRadius: "6px", fontSize: "14px", fontWeight: 600, cursor: "pointer" },
			btnPrimary: { background: "#007AFF", color: "#fff" },
			btnDisabled: { background: "#ccc", color: "#fff", cursor: "not-allowed" },
			msg: { fontSize: "13px", marginLeft: "12px" },
			msgOk: { color: "#28a745" },
			msgErr: { color: "#e44" },
			stat: { fontSize: "13px", lineHeight: "1.8" },
			apiSection: { marginBottom: "20px", padding: "16px", border: "1px solid #ffd700", borderRadius: "8px", background: "#fafafa" },
		};

		/** 渲染加载状态 */
		function renderLoading() {
			return React.createElement("div", { style: { padding: "24px", color: "#888" } }, "加载中...");
		}

		/** 渲染错误状态 */
		function renderError(msg) {
			return React.createElement("div", { style: { padding: "24px", color: "#e44" } }, msg);
		}

		/** 渲染配置表单 */
		function renderForm(config, message, saveMsg, saving, onUpdate, onSave) {
			const isApi = config.embedder === "api";

			const children = [
				// 标题
				React.createElement("h2", { style: style.h2 }, "记忆系统 配置"),

				// 状态区
				React.createElement("div", { style: style.section },
					React.createElement("h3", { style: style.sectionTitle }, "📊 状态"),
					React.createElement("div", { style: style.stat },
						React.createElement("div", null, "当前 Embedder: ", isApi ? "API Embedding" : "简易 Embedder"),
						React.createElement("div", null, message || "查询中..."),
					),
				),

				// 基本配置区
				React.createElement("div", { style: style.section },
					React.createElement("h3", { style: style.sectionTitle }, "🔧 基本配置"),
					React.createElement("div", { style: style.row },
						React.createElement("label", { style: style.label }, "CodeGraph 目录"),
						React.createElement("input", {
							style: style.input,
							value: config.codegraphDir || "",
							onChange: (e) => onUpdate("codegraphDir", e.target.value)
						}),
					),
					React.createElement("div", { style: style.row },
						React.createElement("label", { style: style.label }, "Embedder 类型"),
						React.createElement("select", {
							style: style.select,
							value: config.embedder || "simple",
							onChange: (e) => onUpdate("embedder", e.target.value)
						},
							React.createElement("option", { value: "simple" }, "简易 Embedder"),
							React.createElement("option", { value: "api" }, "API Embedding"),
						),
					),
				),

				// API 配置区（仅当 embedder === "api" 时显示）
				isApi && React.createElement("div", { style: style.apiSection },
					React.createElement("h3", { style: { ...style.sectionTitle, color: "#b8860b" } }, "🔑 API Embedding"),
					React.createElement("div", { style: style.row },
						React.createElement("input", {
							style: { ...style.input, fontFamily: "monospace" },
							type: "password",
							value: config.apiKey || "",
							onChange: (e) => onUpdate("apiKey", e.target.value),
							placeholder: "API Key"
						}),
					),
					React.createElement("div", { style: style.row },
						React.createElement("input", {
							style: style.input,
							value: config.apiModel || "",
							onChange: (e) => onUpdate("apiModel", e.target.value),
							placeholder: "例如: jina-embeddings-v3"
						}),
					),
					React.createElement("div", { style: style.row },
						React.createElement("input", {
							style: style.input,
							value: config.apiBaseUrl || "",
							onChange: (e) => onUpdate("apiBaseUrl", e.target.value),
							placeholder: "例如: https://api.jina.ai/v1"
						}),
					),
				),

				// 保存按钮区
				React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "12px", marginTop: "8px" } },
					React.createElement("button", {
						onClick: onSave,
						disabled: saving,
						style: saving ? { ...style.btn, ...style.btnDisabled } : { ...style.btn, ...style.btnPrimary }
					}, saving ? "保存中..." : "保存配置"),
					saveMsg && React.createElement("span", {
						style: { ...style.msg, ...(saveMsg.includes("✅") ? style.msgOk : style.msgErr) }
					}, saveMsg),
				),
			];

			return React.createElement("div", { style: style.wrap }, ...children);
		}

		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;

			slots.inject("settings.section", () =>
				slots.register(
					{ name: "settings.section", id: "memory-ai", order: 25, label: () => "记忆系统" },
					() => {
						try {
							const [config, setConfig] = useState(null);
							const [loading, setLoading] = useState(true);
							const [saving, setSaving] = useState(false);
							const [message, setMessage] = useState("");
							const [saveMsg, setSaveMsg] = useState("");

							useEffect(() => {
								rpc("read", {}).then((data) => {
									const c = data.config || data || {};
									if (c.apiKey === undefined) c.apiKey = "";
									setConfig(c);
								}).catch((e) => {
									console.warn("[dsh-memory-ai] 读取配置失败:", e);
								}).finally(() => setLoading(false));

								rpc("health", {}).then((data) => {
									if (data) {
										setMessage(data.dbExists
											? "库文件: " + (data.dbSize / 1024).toFixed(0) + " KB"
											: "⚠️ 语义库文件不存在");
									}
								}).catch(() => {});
							}, []);

							const update = useCallback((key, value) => {
								setConfig((prev) => ({ ...prev, [key]: value }));
							}, []);

							const handleSave = useCallback(async () => {
								setSaving(true);
								setSaveMsg("");
								try {
									await rpc("write", { config });
									setSaveMsg("✅ 已保存，重启后生效");
								} catch (e) {
									setSaveMsg("❌ 保存失败: " + String(e));
								}
								setSaving(false);
							}, [config]);

							if (loading) return renderLoading();
							if (!config) return renderError("无法加载配置");
							return renderForm(config, message, saveMsg, saving, update, handleSave);
						} catch (err) {
							console.error("[dsh-memory-ai] 组件错误:", err);
							return renderError("渲染错误: " + String(err));
						}
					}
				)
			);
		}

		exports.apply = apply;
		return module.exports;
	}
});