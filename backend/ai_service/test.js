

const dummyNavData = {
  "events": [
    {
      "tag": "route_started",
      "summary": "Route to Central Hallway 1: 1 steps",
      "data": {
        "destination_id": "GF_Central_Hall",
        "destination_name": "Central Hallway 1",
        "total_steps": 1,
        "first_step": {
          "direction": "forward",
          "distance": "20 ก้าว",
          "path_type": "open_hall",
          "to_name": "Central Hallway 1",
          "instruction": "ตรงไปข้างหน้า ผ่านทางเดินกว้าง ประมาณ 20 ก้าว จะถึง Central Hallway 1",
          "has_turn_ref": false
        }
      }
    }
  ]
};

async function testAI() {
  try {
    console.log("🚀 Sending dummy JSON to server...");
    const response = await fetch('http://localhost:3000/navigate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(dummyNavData)
    });

    if (!response.ok) {
      console.error("❌ HTTP Error:", response.status, response.statusText);
      const text = await response.text();
      console.error("Response:", text);
      return;
    }
    
    // Decode the AI response from the header
    const encodedText = response.headers.get('x-nav-text');
    const aiSpeech = encodedText ? Buffer.from(encodedText, 'base64').toString('utf8') : "No header found";

    console.log("-----------------------------------------");
    console.log("✅ STATUS: Success");
    console.log("🤖 AI REFINED SPEECH:", aiSpeech);
    console.log("-----------------------------------------");
  } catch (error) {
    console.error("❌ CONNECTION ERROR: Could not reach the server at http://localhost:3000");
    console.error("Make sure your server is running in another terminal!");
  }
}

testAI();