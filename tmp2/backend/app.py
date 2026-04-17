"""
博客系统 Flask API 后端
- 文章 CRUD
- 分类管理
- 内存数据存储（最简方案）
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
from datetime import datetime, timezone
import uuid

app = Flask(__name__)
CORS(app)

# ─── 内存数据存储 ───────────────────────────────────────────────

CATEGORIES = [
    {"id": "tech", "name": "技术"},
    {"id": "life", "name": "生活"},
    {"id": "thoughts", "name": "随想"},
]

POSTS: list[dict] = [
    {
        "id": "1",
        "title": "Flask API 快速入门",
        "content": "Flask 是一个轻量级的 Python Web 框架，非常适合构建 RESTful API。\n\n## 核心概念\n\n1. 路由 (Routing)\n2. 请求与响应\n3. 蓝图 (Blueprints)\n\n```python\n@app.route('/api/hello')\ndef hello():\n    return {'message': 'Hello, World!'}\n```",
        "category": "tech",
        "createdAt": "2025-01-15T10:00:00Z",
        "updatedAt": "2025-01-15T10:00:00Z",
    },
    {
        "id": "2",
        "title": "React + Vite 开发体验",
        "content": "使用 Vite 作为构建工具开发 React 项目，热更新速度极快，开发体验远超传统 webpack 配置。\n\n主要优势：\n- 秒级冷启动\n- 即时热模块替换 (HMR)\n- 开箱即用的 TypeScript 支持",
        "category": "tech",
        "createdAt": "2025-01-16T14:30:00Z",
        "updatedAt": "2025-01-16T14:30:00Z",
    },
    {
        "id": "3",
        "title": "周末徒步记",
        "content": "今天天气晴朗，和朋友一起去郊外徒步。\n\n沿途风景优美，空气清新。走了大约 15 公里，虽然累但非常值得。",
        "category": "life",
        "createdAt": "2025-01-17T09:00:00Z",
        "updatedAt": "2025-01-17T09:00:00Z",
    },
]


# ─── 工具函数 ───────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _find_post(post_id: str) -> dict | None:
    return next((p for p in POSTS if p["id"] == post_id), None)


def _post_summary(post: dict) -> dict:
    """列表视图：返回摘要（不含正文）"""
    return {
        "id": post["id"],
        "title": post["title"],
        "summary": post["content"][:100] + ("..." if len(post["content"]) > 100 else ""),
        "category": post["category"],
        "createdAt": post["createdAt"],
        "updatedAt": post["updatedAt"],
    }


# ─── 分类 API ──────────────────────────────────────────────────

@app.route("/api/categories", methods=["GET"])
def get_categories():
    return jsonify(CATEGORIES)


# ─── 文章 API ──────────────────────────────────────────────────

@app.route("/api/posts", methods=["GET"])
def get_posts():
    """获取文章列表（支持按分类筛选）"""
    category = request.args.get("category")
    posts = POSTS
    if category:
        posts = [p for p in posts if p["category"] == category]
    return jsonify([_post_summary(p) for p in posts])


@app.route("/api/posts/<post_id>", methods=["GET"])
def get_post(post_id: str):
    """获取单篇文章详情"""
    post = _find_post(post_id)
    if not post:
        return jsonify({"error": "文章未找到"}), 404
    return jsonify(post)


@app.route("/api/posts", methods=["POST"])
def create_post():
    """创建新文章"""
    data = request.get_json()
    if not data or not data.get("title") or not data.get("content"):
        return jsonify({"error": "标题和内容不能为空"}), 400

    post = {
        "id": str(uuid.uuid4())[:8],
        "title": data["title"],
        "content": data["content"],
        "category": data.get("category", "thoughts"),
        "createdAt": _now_iso(),
        "updatedAt": _now_iso(),
    }
    POSTS.insert(0, post)
    return jsonify(post), 201


@app.route("/api/posts/<post_id>", methods=["PUT"])
def update_post(post_id: str):
    """更新文章"""
    post = _find_post(post_id)
    if not post:
        return jsonify({"error": "文章未找到"}), 404

    data = request.get_json()
    if not data:
        return jsonify({"error": "请求体为空"}), 400

    post["title"] = data.get("title", post["title"])
    post["content"] = data.get("content", post["content"])
    post["category"] = data.get("category", post["category"])
    post["updatedAt"] = _now_iso()
    return jsonify(post)


@app.route("/api/posts/<post_id>", methods=["DELETE"])
def delete_post(post_id: str):
    """删除文章"""
    post = _find_post(post_id)
    if not post:
        return jsonify({"error": "文章未找到"}), 404

    POSTS.remove(post)
    return jsonify({"message": "删除成功"}), 200


# ─── 启动 ──────────────────────────────────────────────────────

if __name__ == "__main__":
    print("🚀 博客 API 启动: http://localhost:5001")
    print("📖 API 文档:")
    print("   GET    /api/categories       - 获取分类列表")
    print("   GET    /api/posts             - 获取文章列表 (?category=tech)")
    print("   GET    /api/posts/:id         - 获取文章详情")
    print("   POST   /api/posts             - 创建文章")
    print("   PUT    /api/posts/:id         - 更新文章")
    print("   DELETE /api/posts/:id         - 删除文章")
    app.run(debug=True, port=5001)
