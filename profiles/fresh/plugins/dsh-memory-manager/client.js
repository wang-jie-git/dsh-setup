window.__ModuleLoader__.load({
  id: "dsh-memory-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const STORAGE_KEY = 'dsh-memory-manager-sidebar';
    let isStarted = false;

    // 添加 AI Memory 管理菜单项到侧边栏
    function addMemoryMenuItem() {
      const sidebar = document.querySelector('[class*="sidebar"]');
      if (!sidebar) return false;

      // 检查是否已添加
      if (document.querySelector('[data-dsh-memory-menu]')) return true;

      // 创建菜单项
      const menuItem = document.createElement('a');
      menuItem.setAttribute('data-dsh-memory-menu', '');
      menuItem.href = '/ai-memory';
      menuItem.target = '_blank';
      menuItem.style.cssText = `
        display: flex; align-items: center; gap: 8px;
        padding: 10px 16px; margin: 2px 8px;
        color: #8b949e; text-decoration: none;
        font-size: 14px; border-radius: 6px;
        transition: all 0.15s;
        cursor: pointer;
      `;
      menuItem.innerHTML = '🧠 <span>AI Memory</span>';
      menuItem.title = 'AI Memory 管理面板';
      menuItem.onmouseenter = () => { menuItem.style.background = '#1c2333'; menuItem.style.color = '#e1e4e8'; };
      menuItem.onmouseleave = () => { menuItem.style.background = 'transparent'; menuItem.style.color = '#8b949e'; };

      // 找到导航区域插入
      const navArea = sidebar.querySelector('nav, [class*="nav"], [class*="menu"]');
      if (navArea) {
        navArea.appendChild(menuItem);
      } else {
        sidebar.appendChild(menuItem);
      }
      return true;
    }

    function scheduleAdd() {
      if (isStarted) return;
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        isStarted = true;
        addMemoryMenuItem();
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          isStarted = true;
          addMemoryMenuItem();
        });
      }
    }

    // 如果 DOM 已就绪，立即添加；否则延迟
    scheduleAdd();

    // 持续重试（DASH 侧边栏可能是动态加载的）
    let retries = 0;
    const interval = setInterval(() => {
      if (addMemoryMenuItem()) {
        clearInterval(interval);
        return;
      }
      retries++;
      if (retries > 20) clearInterval(interval); // 最多重试 10 秒
    }, 500);

    // 保存引用以便清理
    const cleanup = () => {
      clearInterval(interval);
      const el = document.querySelector('[data-dsh-memory-menu]');
      if (el) el.remove();
    };

    const inject = [];
    function apply(ctx) {
      ctx.on('dispose', cleanup);
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});