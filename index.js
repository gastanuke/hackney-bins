const fs = require('fs');
const axios = require('axios');

const BASE_URL = 'https://waste-api-hackney-live.ieg4.net/f806d91c-e133-43a6-ba9a-c0ae4f4cccf6';

// Helper to get ordinal suffix (1st, 2nd, 3rd, 4th...)
function getOrdinalSuffix(day) {
    if (day > 3 && day < 21) return 'th';
    switch (day % 10) {
        case 1:  return "st";
        case 2:  return "nd";
        case 3:  return "rd";
        default: return "th";
    }
}

// Format date to "Thursday 4th June"
function formatDateLong(date) {
    if (!date) return "No date found";
    const weekday = date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/London' });
    const day = date.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'Europe/London' });
    const month = date.toLocaleDateString('en-GB', { month: 'long', timeZone: 'Europe/London' });
    return `${weekday} ${day}${getOrdinalSuffix(parseInt(day))}_${month}`.replace('_', ' '); // hack to avoid double space if month starts with space
}

async function updateBinSchedule() {
    try {
        console.log("Searching address for '74 Prince George Road'...");
        const searchRes = await axios.post(`${BASE_URL}/property/opensearch`, {
            postcode: "N16 8BY"
        });
        
        const address = searchRes.data.addressSummaries.find(addr => addr.summary.includes('74'));
        if (!address) {
            throw new Error("Address '74 Prince George Road' not found in Hackney's response data.");
        }
        
        console.log(`Found address, fetching property details (systemId: ${address.systemId})...`);
        const propRes = await axios.get(`${BASE_URL}/alloywastepages/getproperty/${address.systemId}`);
        const binIds = propRes.data.providerSpecificFields.attributes_wasteContainersAssignableWasteContainers.split(',');
        
        const binSchedules = [];

        for (const binId of binIds) {
            const binRes = await axios.get(`${BASE_URL}/alloywastepages/getbin/${binId}`);
            const binName = binRes.data.subTitle.trim();
            
            const collRes = await axios.get(`${BASE_URL}/alloywastepages/getcollection/${binId}`);
            const workflows = collRes.data.scheduleCodeWorkflowIDs;
            
            const allDates = [];
            for (const wfId of workflows) {
                const wfRes = await axios.get(`${BASE_URL}/alloywastepages/getworkflow/${wfId}`);
                if (wfRes.data.trigger && wfRes.data.trigger.dates) {
                    allDates.push(...wfRes.data.trigger.dates.map(d => new Date(d)));
                }
            }
            
            allDates.sort((a, b) => a - b);
            
            binSchedules.push({
                name: binName,
                dates: allDates
            });
        }

        // Process dates for JSON and HTML
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        
        // London Time week range calculation
        // We want to check if next collection falls within this calendar week (Monday-Sunday)
        const now = new Date();
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
        const monday = new Date(now.setDate(diff));
        monday.setHours(0, 0, 0, 0);
        
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);

        const binsJson = {};
        const displayDates = {};

        for (const sched of binSchedules) {
            const nextDate = sched.dates.find(d => d >= startOfToday);
            
            let collectedThisWeek = "no";
            let dayOfWeek = "unknown";
            let displayDateStr = "No scheduled collection";
            
            if (nextDate) {
                if (nextDate <= sunday) {
                    collectedThisWeek = "yes";
                }
                const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
                dayOfWeek = days[nextDate.getDay()];
                displayDateStr = formatDateLong(nextDate);
            }
            
            let key = sched.name.toLowerCase();
            if (key.includes('recycling')) {
                key = 'recycling';
            } else if (key.includes('wheeled bin') || key.includes('refuse') || key.includes('rubbish')) {
                key = 'rubbish';
            } else if (key.includes('food')) {
                key = 'food';
            }
            
            binsJson[key] = [collectedThisWeek, dayOfWeek];
            displayDates[key] = displayDateStr;
        }
        
        // Format last updated time in London timezone
        const lastCheckedStr = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' });
        const lastCheckedIso = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/London' }).replace(' ', 'T').substring(0, 19).replace('T', ' ');
        
        binsJson.last_updated = lastCheckedIso;

        // Write the JSON file
        fs.writeFileSync('bins.json', JSON.stringify(binsJson, null, 2));
        console.log('Successfully updated bins.json with live council data.');

        // Generate the static HTML webpage content
        const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bins</title>
    <style>
        body { font-family: -apple-system, sans-serif; background: #000; color: #fff; padding: 20px; font-size: 24px; line-height: 1.4; }
        .item { margin-bottom: 20px; }
        .name { font-weight: bold; }
        .date { color: #888; }
    </style>
</head>
<body>

    <div class="item">
        <div class="name">General Waste</div>
        <div class="date">${displayDates.rubbish || "No date found"}</div>
    </div>

    <div class="item">
        <div class="name">Recycling</div>
        <div class="date">${displayDates.recycling || "No date found"}</div>
    </div>

    <div class="item">
        <div class="name">Food Waste</div>
        <div class="date">${displayDates.food || "No date found"}</div>
    </div>

</body>
</html>`;

        // Write the generated output to a public HTML file
        fs.writeFileSync('index.html', htmlContent);
        console.log('Successfully updated index.html with live council dates.');

    } catch (error) {
        console.error('Error fetching council data:', error.message);
        process.exit(1);
    }
}

updateBinSchedule();