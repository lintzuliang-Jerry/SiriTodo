const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// State Upgrade (Array of Objects)
let todos = {
    today: [],
    routine: [],
    longterm: []
};

// DOM Elements
const micBtn = document.getElementById('mic-btn');
const statusBadge = document.getElementById('recording-status');
const lists = {
    today: document.getElementById('list-today'),
    routine: document.getElementById('list-routine'),
    longterm: document.getElementById('list-longterm')
};

// Auto-generate unique IDs
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

// Initialize
function init() {
    loadTodos();
    renderAll();
    
    // Check auto-record shortcut
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'record') {
        setTimeout(() => startRecording(), 300);
    }
}

// Storage Management & Data Migration
function loadTodos() {
    try {
        const saved = localStorage.getItem('voiceTodosDataV2');
        if (saved) {
            todos = JSON.parse(saved);
        } else {
            const oldSaved = localStorage.getItem('voiceTodosData');
            if (oldSaved) {
                const oldTodos = JSON.parse(oldSaved);
                ['today', 'routine', 'longterm'].forEach(cat => {
                    if(oldTodos[cat]) {
                        todos[cat] = oldTodos[cat].map(text => ({
                            id: generateId(), text: text, done: false
                        }));
                    }
                });
                saveTodos(); 
            }
        }
    } catch (e) {
        console.error("Local storage error", e);
    }
}

function saveTodos() {
    localStorage.setItem('voiceTodosDataV2', JSON.stringify(todos));
}

// ---------------------------------------------------------
// UI Rendering & Interaction
// ---------------------------------------------------------
function renderAll() {
    Object.keys(lists).forEach(category => renderList(category));
}

function renderList(category) {
    const ul = lists[category];
    ul.innerHTML = '';
    
    if (todos[category].length === 0) {
        ul.innerHTML = `<li class="empty-placeholder" style="justify-content: center; opacity: 0.5; pointer-events:none;"><span class="task-text" style="text-align:center; font-size: 14px;">沒有事項</span></li>`;
        return;
    }

    todos[category].forEach((task, index) => {
        const li = document.createElement('li');
        li.dataset.id = task.id;
        li.dataset.category = category;
        if(task.done) li.classList.add('done');
        
        // 1. Checkbox or Number according to section
        if (category === 'routine') {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = task.done;
            checkbox.onchange = (e) => {
                task.done = e.target.checked;
                if(task.done) li.classList.add('done');
                else li.classList.remove('done');
                saveTodos();
            };
            li.appendChild(checkbox);
        } else {
            const numSpan = document.createElement('div');
            numSpan.className = 'task-number';
            numSpan.textContent = index + 1;
            li.appendChild(numSpan);
            
            // Priority Emphasis for top 3 in Today
            if (category === 'today') {
                if (index === 0) li.classList.add('priority-1');
                else if (index === 1) li.classList.add('priority-2');
                else if (index === 2) li.classList.add('priority-3');
            }
        }

        // 2. Text (The Handle)
        const span = document.createElement('div');
        span.className = 'task-text';
        span.textContent = task.text;
        
        // 3. Actions (Edit Button only)
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'task-actions';
        
        const editBtn = document.createElement('button');
        editBtn.className = 'action-btn edit';
        editBtn.innerHTML = '✎';
        editBtn.onclick = () => {
            const newText = prompt('編輯任務內容：', task.text);
            if (newText !== null && newText.trim() !== '') {
                task.text = newText.trim();
                saveTodos();
                renderList(category);
            }
        };

        actionsDiv.appendChild(editBtn);

        li.appendChild(span);
        li.appendChild(actionsDiv);
        
        // Custom 100% JS Drag Engine
        bindGestures(li, task.id, category);

        ul.appendChild(li);
    });
}

// Add manual task
window.addManualTask = function(category) {
    todos[category].push({ id: generateId(), text: '新工作事項', done: false });
    saveTodos();
    renderList(category);
};

window.resetRoutine = function() {
    todos['routine'].forEach(t => t.done = false);
    saveTodos();
    renderList('routine');
};

function deleteItemById(category, id) {
    todos[category] = todos[category].filter(t => t.id !== id);
    saveTodos();
    renderList(category);
}

// ---------------------------------------------------------
// Unified Pure JS Gesture Engine (Replaces Sortable & Old Swipe)
// ---------------------------------------------------------
function bindGestures(li, id, category) {
    let startX = 0, startY = 0;
    let isDragging = false;
    let gestureType = null; // 'swipe' or 'sort'
    let clone = null, placeholder = null;

    const handle = li.querySelector('.task-text');
    
    handle.addEventListener('pointerdown', (e) => {
        // Ignore right clicks
        if(e.button !== 0 && e.type !== "touchstart") return; 
        
        startX = e.clientX; 
        startY = e.clientY;
        isDragging = true; 
        gestureType = null;
        
        if (handle.setPointerCapture) {
            handle.setPointerCapture(e.pointerId);
        }
    });

    handle.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const diffX = e.clientX - startX;
        const diffY = e.clientY - startY;

        // Determine intent based on distance
        if (!gestureType) {
            if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
                if (Math.abs(diffX) > Math.abs(diffY)) {
                    gestureType = 'swipe';
                    li.style.transition = 'none';
                } else {
                    gestureType = 'sort';
                    
                    // Create visual placeholder
                    placeholder = document.createElement('li');
                    placeholder.className = li.className;
                    placeholder.style.opacity = '0.3';
                    placeholder.style.border = '2px dashed var(--accent-color)';
                    placeholder.style.height = `${li.offsetHeight}px`;
                    
                    // Create floating clone
                    clone = li.cloneNode(true);
                    const rect = li.getBoundingClientRect();
                    clone.style.position = 'fixed';
                    clone.style.top = `${rect.top}px`;
                    clone.style.left = `${rect.left}px`;
                    clone.style.width = `${rect.width}px`;
                    clone.style.boxSizing = 'border-box';
                    clone.style.zIndex = '9999';
                    clone.style.pointerEvents = 'none'; // let mouse events fall through
                    clone.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';
                    clone.style.transform = `translateY(${diffY}px)`;
                    
                    document.body.appendChild(clone);
                    li.parentNode.insertBefore(placeholder, li);
                    li.style.display = 'none'; // hide original
                }
            }
        }

        // Apply visual transform based on type
        if (gestureType === 'swipe') {
            li.style.transform = `translateX(${diffX}px)`;
            li.style.backgroundColor = Math.abs(diffX) > 80 ? 'var(--bg-delete)' : 'var(--card-bg)';
        } else if (gestureType === 'sort') {
            clone.style.transform = `translateY(${diffY}px)`;
            
            const rect = clone.getBoundingClientRect();
            // Temporarily hide clone to check what elements are underneath it
            clone.style.visibility = 'hidden'; 
            const hoveredEl = document.elementFromPoint(rect.left + rect.width/2, rect.top + rect.height/2);
            clone.style.visibility = 'visible';

            if (!hoveredEl) return;
            
            const hoveredLi = hoveredEl.closest('li');
            const hoveredUl = hoveredEl.closest('ul.todo-list');

            if (hoveredLi && hoveredLi !== placeholder && hoveredLi.dataset.id) {
                const hoverRect = hoveredLi.getBoundingClientRect();
                const hoverMiddleY = hoverRect.top + hoverRect.height / 2;
                if (e.clientY < hoverMiddleY) {
                    hoveredLi.parentNode.insertBefore(placeholder, hoveredLi);
                } else {
                    hoveredLi.parentNode.insertBefore(placeholder, hoveredLi.nextSibling);
                }
            } else if (hoveredUl) {
                // If hovering over the empty category or gap between items
                hoveredUl.appendChild(placeholder);
            }
        }
    });

    const endGesture = (e) => {
        if (!isDragging) return;
        isDragging = false;
        if (handle.releasePointerCapture) {
            handle.releasePointerCapture(e.pointerId);
        }

        if (gestureType === 'swipe') {
            li.style.transition = 'transform 0.3s ease, background-color 0.3s ease';
            const diffX = e.clientX - startX;
            if (Math.abs(diffX) > 80) {
                li.style.transform = `translateX(${diffX > 0 ? 1000 : -1000}px)`; 
                setTimeout(() => deleteItemById(category, id), 250);
            } else {
                li.style.transform = `translateX(0)`;
                li.style.backgroundColor = 'var(--card-bg)';
            }
        } else if (gestureType === 'sort') {
            const dropList = placeholder.parentNode;
            
            // Revert DOM back to normal
            dropList.insertBefore(li, placeholder);
            placeholder.remove();
            clone.remove();
            li.style.display = '';

            // Absolutely Foolproof State Save: Rebuild from the DOM hierarchy
            const allTasks = [...todos.today, ...todos.routine, ...todos.longterm];
            ['today', 'routine', 'longterm'].forEach(cat => {
                const ul = document.getElementById('list-' + cat);
                let newCategoryArray = [];
                Array.from(ul.children).forEach(child => {
                    if (child.dataset.id) {
                        const originalTask = allTasks.find(t => t.id === child.dataset.id);
                        if (originalTask) newCategoryArray.push(originalTask);
                    }
                });
                todos[cat] = newCategoryArray;
            });
            saveTodos();
            renderAll();
        }
        gestureType = null;
    };

    handle.addEventListener('pointerup', endGesture);
    handle.addEventListener('pointercancel', endGesture);
}

// ---------------------------------------------------------
// Rule-Based NLP Parser
// ---------------------------------------------------------
function parseTask(originalText) {
    let category = 'today'; 
    let cleanText = originalText;

    const routines = ['每天', '每週', '每個月', '例行', '固定', '每日'];
    const longterms = ['以後', '長期', '目標', '未來', '將來'];
    const todays = ['今天', '當天', '等一下', '晚點', '馬上', '立刻', '待會', '明早', '明天'];
    
    if (routines.some(kw => originalText.includes(kw))) { category = 'routine'; } 
    else if (longterms.some(kw => originalText.includes(kw))) { category = 'longterm'; } 
    else if (todays.some(kw => originalText.includes(kw))) { category = 'today'; }

    const allKeywords = [...routines, ...longterms, ...todays];
    allKeywords.forEach(kw => {
        cleanText = cleanText.replace(new RegExp(kw, 'g'), '');
    });
    
    cleanText = cleanText.trim();
    if (cleanText.startsWith('要') || cleanText.startsWith('的')) { cleanText = cleanText.substring(1).trim(); }
    if (cleanText.length === 0) { cleanText = originalText; }

    todos[category].push({ id: generateId(), text: cleanText, done: false });
    saveTodos();
    renderAll();
}

// ---------------------------------------------------------
// Recording Interface
// ---------------------------------------------------------
let recognition;
let isRecording = false;

function setupRecognition() {
    if (!SpeechRecognition) {
        alert("不支援語音辨識。請使用 Chrome 或 Safari。");
        return null;
    }
    const rec = new SpeechRecognition();
    rec.lang = 'zh-TW';
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
        isRecording = true;
        micBtn.classList.add('recording');
        statusBadge.classList.remove('hidden');
    };

    rec.onresult = (event) => {
        const text = event.results[0][0].transcript;
        if(text) parseTask(text);
    };

    rec.onerror = (event) => { stopUI(); };
    rec.onend = () => { stopUI(); };
    return rec;
}

function stopUI() {
    isRecording = false;
    micBtn.classList.remove('recording');
    statusBadge.classList.add('hidden');
}

function startRecording() {
    if (isRecording) {
        if(recognition) recognition.stop();
        stopUI();
        return;
    }
    recognition = setupRecognition();
    if (recognition) {
        try { recognition.start(); } 
        catch (e) { console.error("無法啟動錄音", e); stopUI(); }
    }
}

micBtn.addEventListener('click', startRecording);

// Bootstrap
init();
