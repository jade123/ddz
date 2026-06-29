# 斗地主

一个零依赖 Node.js 斗地主项目，支持：

- 实时大厅在线人数
- 在线玩家邀请对战
- 单人 AI 电脑模式
- 叫地主、出牌、不要、炸弹和王炸
- Server-Sent Events 实时同步

## 本地运行

```bash
npm start
```

默认监听 `0.0.0.0:5174`，也可以通过环境变量覆盖：

```bash
PORT=8080 npm start
```

## 生产域名

生产入口配置为 `http://ddz.lure.red`。
