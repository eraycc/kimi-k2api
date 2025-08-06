// kimi API Reverse
class KimiClient {
  private apiEndpoint = "https://www.kimi.com";
  private deviceId: string | null = null;
  private accessToken: string | null = null;

  // 初始化设备认证
  private async initializeAuth(): Promise<void> {
    if (this.accessToken && this.deviceId) return;

    this.deviceId = Math.floor(1000000000000000 + Math.random() * 9000000000000000).toString();
    
    const response = await fetch(`${this.apiEndpoint}/api/device/register`, {
      method: "POST",
      headers: {
        "x-msh-device-id": this.deviceId,
        "x-msh-platform": "web",
        "x-traffic-id": this.deviceId,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      throw new Error(`Authentication failed with status ${response.status}`);
    }

    const data = await response.json();
    if (!data.access_token) {
      throw new Error("No access token received");
    }

    this.accessToken = data.access_token;
  }

  // 创建聊天会话
  private async createConversation(): Promise<string> {
    await this.initializeAuth();

    const response = await fetch(`${this.apiEndpoint}/api/chat`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "未命名会话",
        born_from: "home",
        kimiplus_id: "kimi",
        is_example: false,
        source: "web",
        tags: []
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to create conversation: ${response.status}`);
    }

    const data = await response.json();
    return data.id;
  }

  // 聊天完成方法
  async *chatCompletion(params: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    web_search: boolean;
    stream: boolean;
  }): AsyncGenerator<string, void, unknown> {
    await this.initializeAuth();
    const { messages, web_search } = params;
    const conversationId = await this.createConversation();
    const userMessage = messages.filter(m => m.role === "user").pop()?.content || "";

    const data = {
      kimiplus_id: "kimi",
      extend: { sidebar: true },
      model: "k2",
      use_search: web_search,
      messages: [{ role: "user", content: userMessage }],
      refs: [],
      history: [],
      scene_labels: [],
      use_semantic_memory: false,
      use_deep_research: false
    };

    const response = await fetch(
      `${this.apiEndpoint}/api/chat/${conversationId}/completion/stream`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          "Accept": "text/event-stream"
        },
        body: JSON.stringify(data)
      }
    );

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data:")) {
          const jsonStr = line.substring(5).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);
            if (data.event === "cmpl" && data.text) {
              yield data.text;
            } else if (data.event === "rename") {
              // 可以处理重命名事件，这里暂时忽略
            } else if (data.event === "all_done") {
              // 完成事件
              return;
            }
          } catch (e) {
            console.error("Error parsing SSE data:", e);
          }
        }
      }
    }
  }
}

// 支持的模型
const models = {
  "kimi-k2": {
    id: "kimi-k2",
    object: "model",
    created: Date.now(),
    owned_by: "kimi"
  }
};

const defaultModel = "kimi-k2";

// 处理 /v1/models 端点
function handleModelsRequest(): Response {
  return new Response(
    JSON.stringify({
      object: "list",
      data: Object.values(models)
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
}

// 处理 /v1/chat/completions 端点
async function handleChatRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: {
          message: "Method not allowed",
          type: "invalid_request_error"
        }
      }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  try {
    const body = await request.json();
    const stream = body.stream || false;
    const model = body.model || defaultModel;
    const messages = body.messages || [];
    const web_search = body.web_search || false;

    // 验证模型
    if (!Object.keys(models).includes(model)) {
      return new Response(
        JSON.stringify({
          error: {
            message: `Model '${model}' not found`,
            type: "invalid_request_error"
          }
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // 验证消息
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({
          error: {
            message: "Messages must be a non-empty array",
            type: "invalid_request_error"
          }
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const kimi = new KimiClient();
    const response = kimi.chatCompletion({
      model,
      messages,
      web_search,
      stream
    });

    if (stream) {
      // 创建 SSE 流
      const readable = new ReadableStream({
        async start(controller) {
          try {
            const encoder = new TextEncoder();
            
            for await (const chunk of response) {
              const data = {
                id: `chatcmpl-${crypto.randomUUID()}`,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{
                  index: 0,
                  delta: {
                    content: chunk
                  },
                  finish_reason: null
                }]
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            }
            
            // 发送完成事件
            const doneData = {
              id: `chatcmpl-${crypto.randomUUID()}`,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: "stop"
              }]
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(doneData)}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (error) {
            console.error("Stream error:", error);
            controller.error(error);
          }
        }
      });

      return new Response(readable, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        }
      });
    } else {
      // 非流式响应
      let fullResponse = "";
      for await (const chunk of response) {
        fullResponse += chunk;
      }

      return new Response(
        JSON.stringify({
          id: `chatcmpl-${crypto.randomUUID()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: fullResponse
            },
            finish_reason: "stop"
          }],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  } catch (error) {
    console.error("Chat completion error:", error);
    return new Response(
      JSON.stringify({
        error: {
          message: "Internal server error",
          type: "server_error"
        }
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}

// 主请求处理器
async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // 添加 CORS 头
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  // 处理 OPTIONS 请求
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  try {
    let response: Response;
    
    if (url.pathname === "/v1/models" && request.method === "GET") {
      response = handleModelsRequest();
    } else if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
      response = await handleChatRequest(request);
    } else if (url.pathname === "/" && request.method === "GET") {
      response = new Response(
        JSON.stringify({ 
          status: "ok", 
          message: "Kimi API Proxy is running",
          endpoints: ["/v1/models", "/v1/chat/completions"]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    } else {
      response = new Response(
        JSON.stringify({ 
          error: {
            message: `Path ${url.pathname} not found`,
            type: "invalid_request_error"
          }
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // 添加 CORS 头到响应
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  } catch (e) {
    console.error("Error in handler:", e);
    return new Response(
      JSON.stringify({ 
        error: {
          message: "Internal server error",
          type: "server_error"
        }
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      }
    );
  }
}

// 启动服务器
console.log("Kimi API Proxy starting...");
Deno.serve(handler);
