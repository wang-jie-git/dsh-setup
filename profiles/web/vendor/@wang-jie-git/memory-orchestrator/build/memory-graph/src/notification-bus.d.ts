/**
 * notification-bus — 通知通道抽象
 *
 * 参考 dsh-memory-evolve 的通知系统设计，提供统一的通道抽象层。
 * 可集成到 Hook 系统的事件驱动机制中，实现主动通知推送。
 *
 * 支持的通道类型：web（站内）, feishu（飞书）, qq（QQ）, wechat（微信）, work_wechat（企业微信）
 */
import { MemoryDatabase } from "./database";
export type ChannelType = "web" | "feishu" | "qq" | "wechat" | "work_wechat";
export interface NotificationChannel {
    id: string;
    channelType: ChannelType;
    name: string;
    configJson: Record<string, unknown>;
    enabled: boolean;
    createdAt: number;
    updatedAt: number;
}
export interface NotificationMessage {
    title: string;
    body: string;
    severity?: "info" | "warning" | "error";
    attachments?: Array<{
        type: "text" | "image" | "file";
        url: string;
        name?: string;
    }>;
}
export interface NotificationResult {
    channelId: string;
    channelType: ChannelType;
    success: boolean;
    error?: string;
}
export interface NotificationChannelInput {
    channelType: ChannelType;
    name: string;
    configJson?: Record<string, unknown>;
}
export declare class NotificationBus {
    private db;
    private adapters;
    constructor(db: MemoryDatabase);
    /**
     * 配置通知通道
     */
    configureChannel(data: NotificationChannelInput): Promise<NotificationChannel>;
    /**
     * 发送通知到指定通道
     */
    sendNotification(channelId: string, message: NotificationMessage): Promise<NotificationResult>;
    /**
     * 发送通知到所有启用的通道
     */
    broadcast(message: NotificationMessage): Promise<NotificationResult[]>;
    /**
     * 列出配置的通道
     */
    listChannels(enabledOnly?: boolean): Promise<NotificationChannel[]>;
    /**
     * 删除通道
     */
    deleteChannel(id: string): Promise<boolean>;
}
//# sourceMappingURL=notification-bus.d.ts.map