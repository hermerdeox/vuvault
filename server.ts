import indexHtml from "./index.html";

const port = process.env.PORT || 5173;

console.log(`Starting VuVault server on port ${port}...`);

const server = Bun.serve({
  port,
  
  async fetch(req) {
    const url = new URL(req.url);
    
    // Serve static files from public directory
    if (url.pathname.startsWith('/favicon') || 
        url.pathname.startsWith('/icon-') || 
        url.pathname === '/robots.txt' ||
        url.pathname === '/manifest.webmanifest') {
      const file = Bun.file(`./public${url.pathname}`);
      if (await file.exists()) {
        return new Response(file);
      }
    }
    
    // Serve static files from dist directory (for production builds)
    if (url.pathname.startsWith('/assets/')) {
      const file = Bun.file(`./dist${url.pathname}`);
      if (await file.exists()) {
        return new Response(file);
      }
    }
    
    // API routes can be added here
    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ 
        error: "API endpoint not implemented" 
      }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // For all other routes, serve the index.html (SPA routing)
    return new Response(indexHtml, {
      headers: {
        "Content-Type": "text/html",
      },
    });
  },
  
  development: {
    hmr: true,
    console: true,
  },
  
  error(error) {
    console.error("Server error:", error);
    return new Response("Internal Server Error", { status: 500 });
  },
});

console.log(`✅ VuVault server running at http://localhost:${server.port}`);
console.log(`   Press Ctrl+C to stop`);

