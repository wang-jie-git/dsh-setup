/**
 * notification-bus — 通知通道抽象
 *
 * 参考 dsh-memory-evolve 的通知系统设计，提供统一的通道抽象层。
 * 可集成到 Hook 系统的事件驱动机制中，实现主动通知推送。
 *
 * 支持的通道类型：web（站内）, feishu（飞书）, qq（QQ）, wechat（微信）, work_wechat（企业微信）
 */
// ===== Built-in Adapters =====
class WebChannelAdapter {
    async send(message) {
        // Web 站内通知：写入通知日志，供 Web UI 轮询
        console.log(`[Notification/Web] ${message.severity ?? "info"}: ${message.title} - ${message.body}`);
        return true;
    }
}
// 预留外部通道适配器框架
class ExternalChannelAdapter {
    channelType;
    config;
    constructor(channelType, config) {
        this.channelType = channelType;
        this.config = config;
    }
    async send(message) {
        console.log(`[Notification/${this.channelType}] ${message.title} - ${message.body}`);
        // 实际实现需要各通道的 API 集成
        console.warn(`[Notification/${this.channelType}] 外部通道适配器未实现，需配置 API 密钥`);
        return false;
    }
}
// ===== NotificationBus =====
export class NotificationBus {
    db;
    adapters = new Map();
    constructor(db) {
        this.db = db;
        // 默认注册 web 通道
        this.adapters.set("web", new WebChannelAdapter());
    }
    /**
     * 配置通知通道
     */
    configureChannel(data) {
        const result = this.db.createNotificationChannel({
            channelType: data.channelType,
            name: data.name,
            configJson: data.configJson,
        });
        // 注册适配器
        if (data.channelType === "web") {
            this.adapters.set(result.id, new WebChannelAdapter());
        }
        else {
            this.adapters.set(result.id, new ExternalChannelAdapter(data.channelType, data.configJson ?? {}));
        }
        return Promise.resolve({
            id: result.id,
            channelType: result.channelType,
            name: result.name,
            configJson: data.configJson ?? {},
            enabled: true,
            createdAt: result.createdAt,
            updatedAt: result.createdAt,
        });
    }
    /**
     * 发送通知到指定通道
     */
    async sendNotification(channelId, message) {
        const adapter = this.adapters.get(channelId);
        if (!adapter) {
            return {
                channelId,
                channelType: "web",
                success: false,
                error: `Channel not found: ${channelId}`,
            };
        }
        try {
            const success = await adapter.send(message);
            return {
                channelId,
                channelType: "web", // 简化版
                success,
            };
        }
        catch (err) {
            return {
                channelId,
                channelType: "web",
                success: false,
                error: err.message,
            };
        }
    }
    /**
     * 发送通知到所有启用的通道
     */
    async broadcast(message) {
        const channels = this.db.listNotificationChannels(true);
        const results = [];
        for (const channel of channels) {
            const result = await this.sendNotification(channel.id, message);
            results.push(result);
        }
        return results;
    }
    /**
     * 列出配置的通道
     */
    listChannels(enabledOnly = false) {
        const rows = this.db.listNotificationChannels(enabledOnly);
        return Promise.resolve(rows.map((r) => ({
            id: r.id,
            channelType: r.channel_type,
            name: r.name,
            configJson: (() => {
                try {
                    return JSON.parse(r.config_json ?? "{}");
                }
                catch {
                    return {};
                }
            })(),
            enabled: r.enabled === 1,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        })));
    }
    /**
     * 删除通道
     */
    deleteChannel(id) {
        this.adapters.delete(id);
        return Promise.resolve(this.db.deleteNotificationChannel(id));
    }
}
//# sourceMappingURL=notification-bus.js.map