# kimi-k2api
reverse kimi-k2 to openai api
## 功能说明

1. **模型列表端点 (`/v1/models`)**:
   - 返回 OpenAI 标准格式的模型列表
   - 目前只支持 `kimi-k2` 模型

2. **聊天完成端点 (`/v1/chat/completions`)**:
   - 处理 POST 请求
   - 支持流式和非流式响应
   - 将用户消息转发到 Kimi API
   - 将 Kimi 的响应转换为 OpenAI 标准格式

3. **认证流程**:
   - 自动生成设备 ID
   - 注册设备获取访问令牌
   - 为每个会话创建新的聊天 ID

4. **流式响应处理**:
   - 实时解析 Kimi 的 SSE 流
   - 转换为 OpenAI 兼容的 SSE 格式

5. **错误处理**:
   - 验证输入参数
   - 捕获和处理各种错误
   - 返回适当的错误响应

## 使用说明

1. 保存为 `kimi_proxy.ts`
2. 运行: `deno run --allow-net kimi_proxy.ts`
3. 测试端点:
   - `GET /v1/models`
   - `POST /v1/chat/completions` 带有 JSON 请求体
