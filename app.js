const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// State Upgrade (Array of Objects)
let todos = {
    today: [],
    routine: [],
    longterm: []
};

// Configurable Keywords (longterm is now the fallback category — no keywords needed)
let keywordRules = {
    routine: ['每天', '每週', '每個月', '例行', '固定', '每日'],
    today: ['今天', '當天', '等一下', '晚點', '馬上', '立刻', '待會', '明早', '明天'],
    longterm: []
};

// Edit modal state
let editContext = null; // { category, taskId, isNew }

// DOM Elements
const micBtn = document.getElementById('mic-btn');
const statusBadge = document.getElementById('recording-status');

// Remove single ID lists -> replaced by document.querySelectorAll('.list-...') inside renderList
const listSelectors = {
    today: '.list-today',
    routine: '.list-routine',
    longterm: '.list-longterm'
};

// Auto-generate unique IDs
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

// --- Pager Navigation & Infinite Loop Wrap Around ---
window.scrollToPage = function(index) {
    const pager = document.getElementById('pager');
    // We add 1 because visually Page 1 is at 100vw, Page 2 is at 200vw
    pager.scrollBehavior = 'smooth';
    pager.scrollTo({ left: window.innerWidth * (index + 1), behavior: 'smooth' });
};

function initPagerWrapAround() {
    const pager = document.getElementById('pager');
    
    // Jump to Real Page 1 immediately on load without animation
    setTimeout(() => {
        pager.style.scrollBehavior = 'auto';
        pager.scrollLeft = window.innerWidth;
        setTimeout(() => pager.style.scrollBehavior = 'smooth', 50);
    }, 0);

    let isWrapping = false;
    
    pager.addEventListener('scroll', () => {
        if (isWrapping) return;
        
        const maxScroll = window.innerWidth * 3;
        const currentLeft = pager.scrollLeft;

        // Hit Clone 2 (Far Left)
        if (currentLeft === 0) {
            isWrapping = true;
            pager.style.scrollBehavior = 'auto';
            pager.scrollLeft = window.innerWidth * 2; // Jump to Real 2
            setTimeout(() => {
                pager.style.scrollBehavior = 'smooth';
                isWrapping = false;
            }, 50);
        }
        // Hit Clone 1 (Far Right)
        else if (currentLeft >= maxScroll - 5) { // Safe margin
            isWrapping = true;
            pager.style.scrollBehavior = 'auto';
            pager.scrollLeft = window.innerWidth * 1; // Jump to Real 1
            setTimeout(() => {
                pager.style.scrollBehavior = 'smooth';
                isWrapping = false;
            }, 50);
        }
        
        // Update dots (calculate based on 100vw = index 0)
        let dotIndex = Math.round(currentLeft / window.innerWidth) - 1;
        if (dotIndex < 0) dotIndex = 1;
        if (dotIndex > 1) dotIndex = 0;
        
        document.querySelectorAll('.dot').forEach((dot, i) => {
            dot.classList.toggle('active', i === dotIndex);
        });
    }, { passive: true });
}

// Initialize
function init() {
    loadTodos();
    renderAll();
    initPagerWrapAround();
    initPagerDrag();
    
    // Check auto-record shortcut
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'record') {
        setTimeout(() => startRecording(), 300);
    }
}

// ---------------------------------------------------------
// Pager Drag Engine (Desktop Mouse Support)
// ---------------------------------------------------------
function initPagerDrag() {
    const pager = document.getElementById('pager');
    let isPagerDragging = false;
    let startX = 0;
    let startScrollLeft = 0;

    pager.addEventListener('pointerdown', (e) => {
        // Let Mobile/Touch devices use their own perfect hardware-accelerated native swipe!
        if (e.pointerType === 'touch') return;

        // Only allow dragging on empty areas (ignore tasks & buttons)
        if (e.target.closest('.task-text') || e.target.closest('button') || e.target.closest('input') || e.target.closest('.drag-handle')) return;
        
        isPagerDragging = true;
        startX = e.clientX;
        startScrollLeft = pager.scrollLeft;
        
        // Disable smooth snapping while actively dragging so it tracks 1:1
        pager.style.scrollBehavior = 'auto'; 
        pager.style.scrollSnapType = 'none'; 
        document.body.style.cursor = 'grabbing';
    });

    pager.addEventListener('pointermove', (e) => {
        if (!isPagerDragging) return;
        const diffX = e.clientX - startX;
        pager.scrollLeft = startScrollLeft - diffX;
    });

    const stopDrag = () => {
        if (!isPagerDragging) return;
        isPagerDragging = false;
        document.body.style.cursor = '';
        pager.style.scrollBehavior = 'smooth';
        pager.style.scrollSnapType = 'x mandatory';
        
        // Snap to nearest page (0, 1, 2, or 3)
        const rawIndex = Math.round(pager.scrollLeft / window.innerWidth);
        pager.scrollTo({ left: window.innerWidth * rawIndex, behavior: 'smooth' });
    };

    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
}

// Storage Management & Data Migration
function loadTodos() {
    try {
        const saved = localStorage.getItem('voiceTodosDataV2');
        if (saved) {
            todos = JSON.parse(saved);
        }
        const savedKws = localStorage.getItem('voiceKeywords');
        if (savedKws) {
            keywordRules = JSON.parse(savedKws);
        }
    } catch (e) {
        console.error("Local storage error", e);
    }
}

function saveTodos() {
    localStorage.setItem('voiceTodosDataV2', JSON.stringify(todos));
}
function saveKeywordsState() {
    localStorage.setItem('voiceKeywords', JSON.stringify(keywordRules));
}

// Settings Modal
window.openSettingsModal = function() {
    document.getElementById('kw-routine').value = keywordRules.routine.join(',');
    document.getElementById('kw-today').value = keywordRules.today.join(',');
    document.getElementById('settings-modal').classList.add('active');
};
window.closeSettingsModal = function() {
    document.getElementById('settings-modal').classList.remove('active');
};
window.saveSettings = function() {
    keywordRules.routine = document.getElementById('kw-routine').value.split(',').map(s=>s.trim()).filter(s=>s);
    keywordRules.today = document.getElementById('kw-today').value.split(',').map(s=>s.trim()).filter(s=>s);
    keywordRules.longterm = [];
    saveKeywordsState();
    closeSettingsModal();
};

// Edit / New Task Modal
window.openEditModal = function(category, taskId, isNew) {
    editContext = { category, taskId, isNew: !!isNew };
    const task = todos[category].find(t => t.id === taskId);
    if (!task) return;
    document.getElementById('edit-modal-title').textContent = isNew ? '新增任務' : '編輯任務';
    const ta = document.getElementById('edit-text');
    ta.value = task.text || '';
    document.getElementById('edit-modal').classList.add('active');
    setTimeout(() => { ta.focus(); ta.select(); }, 50);
};
window.closeEditModal = function() {
    document.getElementById('edit-modal').classList.remove('active');
    // If user cancelled a fresh new card, remove it
    if (editContext && editContext.isNew) {
        const { category, taskId } = editContext;
        const task = todos[category].find(t => t.id === taskId);
        if (task && !task.text.trim()) {
            todos[category] = todos[category].filter(t => t.id !== taskId);
            saveTodos();
            renderAll();
        }
    }
    editContext = null;
};
window.saveEditModal = function() {
    if (!editContext) return;
    const { category, taskId, isNew } = editContext;
    const text = document.getElementById('edit-text').value.trim();
    const task = todos[category].find(t => t.id === taskId);
    if (task) {
        if (isNew && !text) {
            todos[category] = todos[category].filter(t => t.id !== taskId);
        } else if (text) {
            task.text = text;
        }
        saveTodos();
        renderAll();
    }
    document.getElementById('edit-modal').classList.remove('active');
    editContext = null;
};

// ---------------------------------------------------------
// UI Rendering & Interaction (Cloning Aware)
// ---------------------------------------------------------

function updateCategoryHints() {
    document.querySelectorAll('.section-header h2').forEach(h2 => {
        const hintSpan = h2.querySelector('.hint');
        if (!hintSpan) return;
        if (hintSpan.classList.contains('hint-routine')) {
            hintSpan.textContent = '(' + (keywordRules.routine.slice(0, 2).join('、') || '—') + ')';
        } else if (hintSpan.classList.contains('hint-today')) {
            hintSpan.textContent = '(' + (keywordRules.today.slice(0, 2).join('、') || '—') + ')';
        }
    });
}

function updateCountBadges() {
    ['today', 'routine', 'longterm'].forEach(cat => {
        const n = todos[cat].length;
        document.querySelectorAll(`[data-count-for="${cat}"]`).forEach(el => {
            el.textContent = n;
        });
    });
}

function renderAll() {
    Object.keys(listSelectors).forEach(category => renderList(category));
    updateCategoryHints();
    updateCountBadges();
}

function renderList(category) {
    const uls = document.querySelectorAll(listSelectors[category]);
    
    uls.forEach(ul => {
        ul.innerHTML = '';

        // Cross-category drop slot (only for today <-> longterm)
        if (category === 'today' || category === 'longterm') {
            const slot = document.createElement('li');
            slot.className = 'cross-drop-slot';
            slot.dataset.target = category === 'today' ? 'longterm' : 'today';
            slot.innerHTML = `<span class="task-text">↕ 拖曳至此 → 移動到「${category === 'today' ? '長期' : '當天'}待辦」</span>`;
            ul.appendChild(slot);
        }

        if (todos[category].length === 0) {
            const empty = document.createElement('li');
            empty.className = 'empty-placeholder';
            empty.style.cssText = 'justify-content: center; opacity: 0.5; pointer-events:none;';
            empty.innerHTML = `<span class="task-text" style="text-align:center; font-size: 14px;">沒有事項</span>`;
            ul.appendChild(empty);
            return;
        }

        todos[category].forEach((task, index) => {
            const li = document.createElement('li');
            li.dataset.id = task.id;
            li.dataset.category = category;
            if(task.done) li.classList.add('done');
            
            // 0. Dedicated Drag Handle (Prevents swiping conflicts)
            const handleDiv = document.createElement('div');
            handleDiv.className = 'drag-handle';
            handleDiv.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle></svg>`;
            li.appendChild(handleDiv);

            // 1. Checkbox or Number according to section
            if (category === 'routine') {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = task.done;
                checkbox.onchange = (e) => {
                    task.done = e.target.checked;
                    saveTodos();
                    renderAll(); // Sync to all clones instantly
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

            // 2. Text
            const span = document.createElement('div');
            span.className = 'task-text';
            span.textContent = task.text;
            
            // 3. Actions (Edit + Delete)
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'task-actions';
            
            const editBtn = document.createElement('button');
            editBtn.className = 'action-btn edit';
            editBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
            editBtn.onclick = () => {
                openEditModal(category, task.id, false);
            };

            const delBtn = document.createElement('button');
            delBtn.className = 'action-btn delete-btn';
            delBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
            delBtn.style.color = '#ff8da1';
            delBtn.onclick = () => {
                // Apply Shatter Animation before deleting
                li.classList.add('deleting-anim');
                setTimeout(() => deleteItemById(category, task.id), 250);
            };

            actionsDiv.appendChild(editBtn);
            actionsDiv.appendChild(delBtn);

            li.appendChild(span);
            li.appendChild(actionsDiv);
            
            // Custom 100% JS Drag Engine - Now heavily isolated to the Handle!
            bindGestures(li, handleDiv, task.id, category);

            ul.appendChild(li);
        });
    });
}

// Add manual task — create an empty card and immediately open the edit modal
window.addManualTask = function(category) {
    const newTask = { id: generateId(), text: '', done: false };
    if (category === 'routine') {
        todos[category].push(newTask);
    } else {
        todos[category].unshift(newTask);
    }
    saveTodos();
    renderAll();
    openEditModal(category, newTask.id, true);
};

window.resetRoutine = function() {
    todos['routine'].forEach(t => t.done = false);
    saveTodos();
    renderAll();
};

function deleteItemById(category, id) {
    todos[category] = todos[category].filter(t => t.id !== id);
    saveTodos();
    renderAll();
}

// ---------------------------------------------------------
// Unified Pure JS Gesture Engine (Drag to Sort ONLY)
// ---------------------------------------------------------
function bindGestures(li, handle, id, category) {
    let startY = 0;
    let isDragging = false;
    let clone = null, placeholder = null;
    let lastY = 0;
    let currentY = 0; // Track for auto-scroll
    
    handle.addEventListener('pointerdown', (e) => {
        // Ignore right clicks
        if(e.button !== 0 && e.type !== "touchstart") return; 
        
        startY = e.clientY;
        lastY = e.clientY;
        currentY = e.clientY;
        isDragging = true; 
        
        if (handle.setPointerCapture) {
            handle.setPointerCapture(e.pointerId);
        }

        // --- Auto Edge-Scroll Engine ---
        const autoScroll = () => {
            if (!isDragging) return;
            if (clone && placeholder) {
                const ul = placeholder.closest('ul.todo-list');
                if (ul) {
                    // In drag-expand mode, body scrolls vertically
                    const isExpanded = document.body.classList.contains('dragging-active');
                    const scroller = isExpanded ? document.documentElement : ul;
                    const edge = 55;
                    let scrollSpeed = 0;

                    if (currentY < edge) scrollSpeed = -8;
                    else if (currentY > window.innerHeight - edge) scrollSpeed = 8;

                    if (scrollSpeed !== 0) {
                        scroller.scrollTop += scrollSpeed;
                        
                        // Dynamically re-evaluate collision while container is sliding under cursor
                        clone.style.visibility = 'hidden'; 
                        const cloneRect = clone.getBoundingClientRect();
                        const cloneMiddleY = cloneRect.top + cloneRect.height / 2;
                        const hoveredEl = document.elementFromPoint(cloneRect.left + cloneRect.width/2, cloneMiddleY);
                        clone.style.visibility = 'visible';

                        if (hoveredEl) {
                            const hoveredLi = hoveredEl.closest('li');
                            if (hoveredLi && hoveredLi !== placeholder && hoveredLi.dataset.id) {
                                const placeholderIndex = Array.from(placeholder.parentNode.children).indexOf(placeholder);
                                const hoveredIndex = Array.from(hoveredLi.parentNode.children).indexOf(hoveredLi);
                                
                                const hoverRect = hoveredLi.getBoundingClientRect();
                                const hoverMiddleY = hoverRect.top + hoverRect.height / 2;
                                
                                if (placeholderIndex < hoveredIndex && cloneMiddleY > hoverMiddleY) {
                                    hoveredLi.parentNode.insertBefore(placeholder, hoveredLi.nextSibling);
                                } else if (placeholderIndex > hoveredIndex && cloneMiddleY < hoverMiddleY) {
                                    hoveredLi.parentNode.insertBefore(placeholder, hoveredLi);
                                }
                            }
                        }
                    }
                }
            }
            requestAnimationFrame(autoScroll);
        };
        requestAnimationFrame(autoScroll);
    });

    handle.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const diffY = e.clientY - startY;
        currentY = e.clientY;
        
        // Direction parameters for anti-jitter deadzone
        const movingDown = currentY > lastY;
        const movingUp = currentY < lastY;

        // Initialize drag visual when pulled significantly
        if (!clone && Math.abs(diffY) > 5) {
            // Activate drag-expand mode
            document.body.classList.add('dragging-active');
            document.body.classList.add(`dragging-from-${category}`);
            // For longterm overlay: record header bottom as CSS var so fixed panel starts below header
            if (category === 'longterm') {
                const hdr = document.querySelector('header');
                const hdrBottom = hdr ? hdr.getBoundingClientRect().bottom : 100;
                document.documentElement.style.setProperty('--drag-panel-top', hdrBottom + 'px');
            }

            // Create visual placeholder
            placeholder = document.createElement('li');
            placeholder.className = li.className;
            placeholder.style.opacity = '0.3';
            placeholder.style.border = '2px dashed var(--accent-color)';
            placeholder.style.height = `${li.offsetHeight}px`;
            placeholder.style.margin = '0';
            
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
            clone.style.boxShadow = '0 15px 35px rgba(0,0,0,0.2)';
            clone.style.opacity = '0.9';
            clone.style.transform = `translateY(${diffY}px) scale(1.02)`;
            clone.style.transition = 'transform 0.05s linear'; // smoothing
            
            document.body.appendChild(clone);
            li.parentNode.insertBefore(placeholder, li);
            li.style.display = 'none'; // hide original
        }

        // Apply visual transform
        if (clone) {
            clone.style.transform = `translateY(${diffY}px) scale(1.02)`;
            
            const cloneRect = clone.getBoundingClientRect();
            const cloneMiddleY = cloneRect.top + cloneRect.height / 2;
            clone.style.visibility = 'hidden'; 
            const hoveredEl = document.elementFromPoint(cloneRect.left + cloneRect.width/2, cloneMiddleY);
            clone.style.visibility = 'visible';

            if (hoveredEl) {
                const slot = hoveredEl.closest('.cross-drop-slot');
                const hoveredLi = hoveredEl.closest('li');
                const hoveredUl = hoveredEl.closest('ul.todo-list');

                // Highlight slot on hover, clear others
                document.querySelectorAll('.cross-drop-slot.slot-hovered').forEach(el => {
                    if (el !== slot) el.classList.remove('slot-hovered');
                });
                if (slot) slot.classList.add('slot-hovered');

                if (slot) {
                    // Cross-category drop: move placeholder into the target list (right after its own slot)
                    const targetUl = document.querySelector(`.page.real .list-${slot.dataset.target}`);
                    if (targetUl && placeholder.parentNode !== targetUl) {
                        const targetSlot = targetUl.querySelector('.cross-drop-slot');
                        if (targetSlot) targetUl.insertBefore(placeholder, targetSlot.nextSibling);
                        else targetUl.insertBefore(placeholder, targetUl.firstChild);
                    }
                } else if (hoveredLi && hoveredLi !== placeholder && hoveredLi.dataset.id) {
                    const placeholderIndex = Array.from(placeholder.parentNode.children).indexOf(placeholder);
                    const hoveredIndex = Array.from(hoveredLi.parentNode.children).indexOf(hoveredLi);

                    const hoverRect = hoveredLi.getBoundingClientRect();
                    const hoverMiddleY = hoverRect.top + hoverRect.height / 2;

                    if (placeholderIndex < hoveredIndex && cloneMiddleY > hoverMiddleY) {
                        hoveredLi.parentNode.insertBefore(placeholder, hoveredLi.nextSibling);
                    } else if (placeholderIndex > hoveredIndex && cloneMiddleY < hoverMiddleY) {
                        hoveredLi.parentNode.insertBefore(placeholder, hoveredLi);
                    }
                } else if (hoveredUl) {
                    // Allows dropping into an empty category list natively
                    hoveredUl.appendChild(placeholder);
                }
            }
        }
        lastY = currentY;
    });

    const endGesture = (e) => {
        if (!isDragging) return;
        isDragging = false;
        document.body.classList.remove('dragging-active');
        document.body.classList.remove(`dragging-from-${category}`);
        document.documentElement.scrollTop = 0;
        // Clear any slot highlight
        document.querySelectorAll('.cross-drop-slot.slot-hovered').forEach(el => el.classList.remove('slot-hovered'));
        if (handle.releasePointerCapture) {
            handle.releasePointerCapture(e.pointerId);
        }

        if (clone) {
            const dropList = placeholder.parentNode;
            
            dropList.insertBefore(li, placeholder);
            placeholder.remove();
            clone.remove();
            li.style.display = '';

            // VERY IMPORTANT: Read the state from the active cloned page the user was looking at!
            const activePage = li.closest('.page');
            const allTasks = [...todos.today, ...todos.routine, ...todos.longterm];
            
            ['today', 'routine', 'longterm'].forEach(cat => {
                let ul = activePage.querySelector('.list-' + cat);
                // Fallback to real DOM if the list doesn't exist on this active page copy
                if (!ul) ul = document.querySelector('.page.real .list-' + cat);
                if (!ul) return;
                
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
            renderAll(); // Sync to all clones instantly
            
            clone = null;
            placeholder = null;
        }
    };

    handle.addEventListener('pointerup', endGesture);
    handle.addEventListener('pointercancel', endGesture);
}

// ---------------------------------------------------------
// Rule-Based NLP Parser
// ---------------------------------------------------------
function parseTask(originalText) {
    let category = 'longterm'; // default fallback: no keyword → longterm
    let cleanText = originalText;

    const routines = keywordRules.routine;
    const todays = keywordRules.today;

    if (routines.some(kw => originalText.includes(kw))) { category = 'routine'; }
    else if (todays.some(kw => originalText.includes(kw))) { category = 'today'; }

    const allKeywords = [...routines, ...todays];
    allKeywords.forEach(kw => {
        cleanText = cleanText.replace(new RegExp(kw, 'g'), '');
    });

    cleanText = cleanText.trim();
    if (cleanText.startsWith('要') || cleanText.startsWith('的')) { cleanText = cleanText.substring(1).trim(); }
    if (cleanText.length === 0) { cleanText = originalText; }

    const newTask = { id: generateId(), text: cleanText, done: false };
    if (category === 'routine') {
        todos[category].push(newTask);
    } else {
        todos[category].unshift(newTask);
    }
    saveTodos();
    renderAll();
    
    // Jump to the correct page via native snap index
    if (category === 'routine') {
        scrollToPage(1);
    } else {
        scrollToPage(0);
    }
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
