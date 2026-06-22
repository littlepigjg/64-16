# Local Registry Proxy

本地私有 NPM / PyPI 镜像代理缓存系统。

## 功能特性

- 🚀 **代理转发**: 代理 NPM 和 PyPI 官方仓库请求
- 💾 **智能缓存**: 缓存安装过的包到本地，下次直接走本地
- 📦 **私有包管理**: 支持 scope 隔离的私有包上传和版本管理
- 📊 **管理面板**: Web 界面查看缓存包、统计信息、配置策略
- 🧹 **灵活清理**: 手动清理单个包或按策略自动清理

## 项目结构

```
.
├── server/          # 后端服务 (Express + SQLite)
│   └── src/
│       ├── modules/
│       │   ├── proxy/          # 代理转发模块
│       │   ├── cache/          # 缓存存储模块
│       │   ├── private-pkg/    # 私有包管理模块
│       │   └── metadata/       # 元数据索引模块
│       └── ...
├── client/          # 前端管理面板 (React + Vite)
└── storage/         # 包文件存储目录 (运行时生成)
```

## 快速开始

```bash
# 安装依赖
npm run install:all

# 开发模式 (同时启动前后端)
npm run dev

# 生产构建
npm run build

# 启动服务
npm start
```

## NPM 使用

```bash
# 设置 registry
npm config set registry http://localhost:4873/npm

# 或者临时使用
npm install --registry http://localhost:4873/npm <package-name>

# 发布私有包 (scope: @myorg)
npm publish --registry http://localhost:4873/npm
```

## PIP 使用

```bash
# 使用镜像
pip install -i http://localhost:4873/pypi/simple/ <package-name>

# 或者配置到 pip.conf
pip config set global.index-url http://localhost:4873/pypi/simple/
```

## Web 管理界面

访问: http://localhost:4873
