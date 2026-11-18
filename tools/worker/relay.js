/**
 * 金山 webhook 中转（Cloudflare Worker）
 *
 * 为什么需要它
 *   实测：向 kdocs 的 sync_task 地址发 OPTIONS 预检，返回 403 且响应里没有任何
 *   Access-Control-Allow-* 头。浏览器据此会判定「服务端不给跨域」，请求根本不发出去。
 *   金山这套接口是给服务端调用的（官方示例全是 curl / Java / Go / Python / Node），
 *   没打算让网页直接 POST。所以要有一层自己的中转。
 *
 * 顺带解决第二件事
 *   AirScript-Token 是账号级凭据（能读写名下全部金山文档）。放进手机 localStorage
 *   或公开的 GitHub Pages 源码都不合适。挪到这里之后，手机端一个凭据都不带。
 *
 * 部署（全程网页，不用命令行）
 *   1. Cloudflare 控制台 → Workers & Pages → Create → Worker，命名 kaohe-relay
 *   2. Edit code，把本文件整体粘进去，Deploy
 *   3. Settings → Variables and Secrets，加两个 Secret：
 *        KDOCS_URL    金山脚本的 webhook 链接
 *                     https://www.kdocs.cn/api/v3/ide/file/{fileId}/script/{sid}/sync_task
 *        KDOCS_TOKEN  AirScript 脚本令牌
 *      可选 Variable：
 *        ALLOW_ORIGIN 允许的网页来源，默认 *
 *   4. 把 Worker 的地址（https://kaohe-relay.xxx.workers.dev）填进手机打分页的
 *      「提交地址」，令牌留空
 *
 * 请求体完全透传，返回也完全透传 —— 打分页的解析逻辑一行都不用改。
 */

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, AirScript-Token',
    'Access-Control-Max-Age': '86400'
  };
}

function json(obj, status, env) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json;charset=utf-8' }, corsHeaders(env))
  });
}

export default {
  async fetch(request, env) {
    /* 预检：浏览器带 Content-Type: application/json 会先发 OPTIONS，必须 2xx 且带 CORS 头 */
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (request.method !== 'POST') {
      return json({ ok: false, error: '只接受 POST' }, 405, env);
    }
    if (!env.KDOCS_URL || !env.KDOCS_TOKEN) {
      return json({ ok: false, error: '中转未配置：缺 KDOCS_URL 或 KDOCS_TOKEN' }, 500, env);
    }

    /* 原样透传：前端提交的就是金山要的 {Context:{argv:{payload}}} */
    const body = await request.text();
    if (body.length > 12 * 1024 * 1024) {
      return json({ ok: false, error: '请求体超过 12MB，请减少照片' }, 413, env);
    }

    let upstream;
    try {
      upstream = await fetch(env.KDOCS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'AirScript-Token': env.KDOCS_TOKEN
        },
        body: body
      });
    } catch (e) {
      return json({ ok: false, error: '连不上金山：' + (e && e.message ? e.message : String(e)) }, 502, env);
    }

    /* 金山返回 {code, data:{result:"<脚本 return 的字符串>"}}。原样回给前端，
       前端已具备「result 是字符串就再 JSON.parse 一次」的处理。 */
    const text = await upstream.text();

    /* 上游 4xx/5xx 也透传文本，但外包一层，方便前端把错误原因显示出来 */
    if (!upstream.ok) {
      return json({
        ok: false,
        error: '金山返回 ' + upstream.status + '：' + text.slice(0, 500)
      }, 502, env);
    }
    return new Response(text, {
      status: 200,
      headers: Object.assign({ 'Content-Type': 'application/json;charset=utf-8' }, corsHeaders(env))
    });
  }
};
