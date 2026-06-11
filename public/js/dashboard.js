const ctx = document.getElementById('lateChart');
const socket = io();
let chart;

function buildChart(data) {
  const labels = data.rows.map((row) => row.class_name);
  const values = data.rows.map((row) => row.late_count);
  if (!chart) {
    chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Jumlah Terlambat',
          data: values,
          backgroundColor: '#dc3545',
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 }
          }
        }
      }
    });
  } else {
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.update();
  }
}

function buildSummary(data) {
  const container = document.getElementById('summaryCards');
  container.innerHTML = '';
  data.summary.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'col-12';
    card.innerHTML = `<div class="shadow-sm rounded p-3 bg-white"><strong>${item.status || 'Total'}</strong> : ${item.count}</div>`;
    container.appendChild(card);
  });
}

async function refreshStats() {
  try {
    const response = await fetch('/api/stats');
    if (!response.ok) throw new Error('Gagal memuat statistik');
    const data = await response.json();
    buildChart(data);
    buildSummary(data);
  } catch (error) {
    console.error(error);
  }
}

socket.on('connect', () => {
  refreshStats();
});

socket.on('statsUpdate', () => {
  refreshStats();
});

document.addEventListener('DOMContentLoaded', () => {
  refreshStats();
  setInterval(refreshStats, 25000);
});
