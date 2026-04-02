exports.handler = async function(event, context) {
  const targetUrl = event.queryStringParameters.url;
  
  if (!targetUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing 'url' query parameter" })
    };
  }

  try {
    const response = await fetch(targetUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.text();
    
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*", // Bypass CORS
        "Content-Type": "text/csv"
      },
      body: data
    };
  } catch (error) {
    console.error("Proxy error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch data", details: error.message })
    };
  }
};
