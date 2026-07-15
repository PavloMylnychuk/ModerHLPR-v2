(function () {
    'use strict';

    let observer = null;

    chrome.storage.local.get(['scriptEnabled'], (result) => {
        const isEnabled = result.scriptEnabled !== false;
        if (isEnabled) {
            initExtension();
        }
    });

    function initExtension() {
        const templatesTicket = {
            "Оск": "Выдан пред за оскорбление.",
            "Провокация": "Выдан пред за провокацию.",
            "Препятствие": "Выдан пред за препятствие.",
            "Спам": "Выдан пред за спам.",
            "Мониторинг": "Выдан пред за мониторинг.",
            "Расизм": "Выдан пред за расизм.",
            "Обход чист": "Обход чист."
        };

        const templatesNotif = {
            "Оск": "Здравствуйте! Пожалуйста, перестаньте оскорблять игроков.",
            "Провокация": "Здравствуйте! Просим вас не провоцировать других участников.",
            "Препятствие": "Здравствуйте! Не препятствуйте нормальной игре другим.",
            "Спам": "Здравствуйте! Пожалуйста, не спамьте в чат.",
            "Ник": "Ваш ник некорректный. Пожалуйста, измените его.",
            "Мониторинг": "Здравствуйте! Пожалуйста, прекратите мониторинг.",
            "Расизм": "Здравствуйте! На проекте запрещен расизм. Просим прекратить."
        };

        const ipRegex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/;

        function getStoredIPStatus(ip) {
            return localStorage.getItem(`ip_status_${ip}`);
        }

        function setStoredIPStatus(ip, status) {
            if (status) {
                localStorage.setItem(`ip_status_${ip}`, status);
            } else {
                localStorage.removeItem(`ip_status_${ip}`);
            }
        }

        function isMessageWithin24Hours(messageTimestampText) {
            if (!messageTimestampText) return true;
            try {
                const parts = messageTimestampText.trim().split(/\s+/);
                if (parts.length < 2) return true;
                const dateParts = parts[0].split('.');
                const timeParts = parts[1].split(':');
                if (dateParts.length === 3 && timeParts.length === 3) {
                    const messageDate = new Date(
                        parseInt(dateParts[2], 10),
                        parseInt(dateParts[1], 10) - 1,
                        parseInt(dateParts[0], 10),
                        parseInt(timeParts[0], 10),
                        parseInt(timeParts[1], 10),
                        parseInt(timeParts[2], 10)
                    );
                    const now = new Date();
                    const diffInHours = (now - messageDate) / (1000 * 60 * 60);
                    return diffInHours <= 24;
                }
                return true;
            } catch (e) {
                return true;
            }
        }

        function checkAndRegisterPunishment(steamId, textContent) {
            const storageKey = `processed_muts_${steamId}`;
            const cleanText = textContent.trim().toLowerCase();
            let history = JSON.parse(localStorage.getItem(storageKey) || "[]");
            const now = Date.now();

            history = history.filter(item => (now - item.timestamp) < (24 * 60 * 60 * 1000));
            localStorage.setItem(storageKey, JSON.stringify(history));

            const isDuplicate = history.some(item => item.text === cleanText);
            return {
                isDuplicate: isDuplicate,
                register: function () {
                    if (!isDuplicate) {
                        history.push({ text: cleanText, timestamp: now });
                        localStorage.setItem(storageKey, JSON.stringify(history));
                    }
                }
            };
        }

        function updateInfoBadge(elementId, cssStyles, innerHTML, targetTextarea) {
            let badge = document.getElementById(elementId);
            if (!badge) {
                badge = document.createElement('div');
                badge.id = elementId;
                badge.style.cssText = "padding: 10px; margin: 8px 0; font-size: 13px; border-radius: 4px; font-family: sans-serif; font-weight: bold; box-shadow: 0 2px 6px rgba(0,0,0,0.2); " + cssStyles;
                if (targetTextarea && targetTextarea.parentNode) {
                    targetTextarea.parentNode.insertBefore(badge, targetTextarea);
                }
            } else {
                badge.innerHTML = innerHTML;
                badge.style.cssText = "padding: 10px; margin: 8px 0; font-size: 13px; border-radius: 4px; font-family: sans-serif; font-weight: bold; box-shadow: 0 2px 6px rgba(0,0,0,0.2); " + cssStyles;
            }
        }

        async function translateText(text, targetLang = 'RU') {
            try {
                const response = await fetch("https://api-free.deepl.com/v2/translate", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    body: new URLSearchParams({
                        "auth_key": "YOUR_DEEPL_API_KEY",
                        "text": text,
                        "target_lang": targetLang
                    })
                });

                if (!response.ok) return null;
                const data = await response.json();

                if (data && data.translations && data.translations[0]) {
                    return {
                        translated: data.translations[0].text,
                        detectedLang: data.translations[0].detected_source_language.toLowerCase()
                    };
                }
                return null;
            } catch (e) {
                try {
                    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang.toLowerCase()}&dt=t&q=${encodeURIComponent(text)}`;
                    const response = await fetch(url);
                    if (!response.ok) return null;
                    const data = await response.json();
                    if (data && data[0]) {
                        let translated = data[0].map(item => item[0]).join('');
                        let detectedLang = data[2];
                        return { translated, detectedLang };
                    }
                    return null;
                } catch (err) {
                    return null;
                }
            }
        }

        const intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const messageCell = entry.target;
                    intersectionObserver.unobserve(messageCell);

                    let mainTextNode = null;
                    for (let node of messageCell.childNodes) {
                        if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length > 0) {
                            mainTextNode = node;
                            break;
                        }
                    }

                    const messageText = mainTextNode ? mainTextNode.nodeValue.trim() : messageCell.innerText.trim();

                    if (!messageCell.dataset.translatedProcessed && messageText.length > 0) {
                        messageCell.dataset.translatedProcessed = "true";

                        translateText(messageText, 'RU').then(res => {
                            if (res && res.detectedLang !== 'ru' && res.detectedLang !== 'uk') {
                                const trDiv = document.createElement('div');
                                trDiv.style.cssText = "font-size: 11px; color: #64748b; margin-top: 2px; font-style: italic; border-top: 1px dashed rgba(100,116,139,0.2); padding-top: 2px;";
                                trDiv.innerHTML = `🌐 [${res.detectedLang.toUpperCase()}] Перевод: ${res.translated}`;
                                messageCell.appendChild(trDiv);
                            }
                        });
                    }
                }
            });
        }, { rootMargin: '100px 0px 100px 0px' });

        function runChatTranslation() {
            const chatHistoryBlock = Array.from(document.querySelectorAll('div, .card, .block')).find(el => el.innerText && el.innerText.includes('История Чата') && !el.innerText.includes('История Тикетов'));
            if (!chatHistoryBlock) return;

            const rows = Array.from(chatHistoryBlock.querySelectorAll('tbody tr, tr')).filter(row => row.querySelector('td'));

            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 4) {
                    const messageCell = cells[3];
                    if (!messageCell.dataset.translatedProcessed && !messageCell.dataset.observed) {
                        messageCell.dataset.observed = "true";
                        intersectionObserver.observe(messageCell);
                    }
                }
            });
        }

        async function processTicketRules(textarea) {
            const steamBlock = document.querySelector('.player-steamid') || document.querySelector('[data-steamid]');
            const steamId = steamBlock ? (steamBlock.dataset.steamid || steamBlock.innerText.trim()) : "unknown_user";

            const chatHistoryBlock = Array.from(document.querySelectorAll('div, .card, .block')).find(el => el.innerText && el.innerText.includes('История Чата') && !el.innerText.includes('История Тикетов'));

            if (!chatHistoryBlock) {
                updateInfoBadge('helper-suggest-badge', 'background: #1e293b; border-left: 4px solid #64748b; color: #cbd5e1;', '🔍 <b>Анализ чата:</b> Table of chat history not found on the current page.', textarea);
                return;
            }

            const rows = Array.from(chatHistoryBlock.querySelectorAll('tbody tr, tr')).filter(row => row.querySelector('td'));

            if (rows.length === 0 || chatHistoryBlock.innerText.includes('Не найдено') || chatHistoryBlock.innerText.includes('Пусто')) {
                updateInfoBadge('helper-suggest-badge', 'background: #1e293b; border-left: 4px solid #94a3b8; color: #94a3b8;', '💬 <b>Проверка:</b> Чат пуст.', textarea);
                return;
            }

            let counts = {
                heavy: 0,
                medium: 0,
                light: 0,
                racism: 0,
                toxicity: 0
            };

            let firstViolation = null;

            const racismKeywords = [
                "nigga", "нигга", "негр", "nigger", "чурка", "хач", "хохол", "кацап", "чуркан", "ниггер",
                "черножопый", "узкоглазый", "хачик", "жид", "свастика", "зиг", "хайль", "нацик", "чурчела",
                "жиденыш", "укроп", "москаль", "салоед", "hohol", "kacap", "churka", "negr"
            ];

            const toxicityKeywords = [
                "сын шлюхи", "выблядок", "мать ебал", "сын дуры", "маме привет", "мать твоя", "отчим",
                "сын бляди", "мачеха", "ебал твою", "выродок", "ублюдок", "сдохни от рака", "желаю смерти",
                "мать дохлая", "сирота", "гробы", "убейся", "сын ш", "сын проститутки", "шлюха мать",
                "syn shlyuhi", "viblyadok", "mat ebal", "syn dury", "mame privet", "mat tvoya", "syn blyadi",
                "whore", "bitch", "motherfucker", "kill yourself", "kys", "son of a bitch"
            ];

            const convertTranslitToСyrillic = (text) => {
                const rules = {
                    'shh': 'щ', 'sh': 'ш', 'ch': 'ч', 'zh': 'ж', 'yo': 'ё', 'ya': 'я', 'yu': 'ю',
                    'a': 'а', 'b': 'б', 'v': 'в', 'g': 'г', 'd': 'д', 'e': 'е', 'z': 'з', 'i': 'и',
                    'j': 'й', 'k': 'к', 'l': 'л', 'm': 'м', 'n': 'н', 'o': 'о', 'p': 'п', 'r': 'р',
                    's': 'с', 't': 'т', 'u': 'у', 'f': 'ф', 'h': 'х', 'c': 'ц', 'y': 'ы'
                };
                let result = text;
                for (const [eng, rus] of Object.entries(rules)) {
                    result = result.split(eng).join(rus);
                }
                return result;
            };

            for (const row of rows) {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 4) {
                    const timeText = cells[0].innerText.trim();
                    const messageCell = cells[3];

                    let mainTextNode = null;
                    for (let node of messageCell.childNodes) {
                        if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length > 0) {
                            mainTextNode = node;
                            break;
                        }
                    }
                    const messageText = mainTextNode ? mainTextNode.nodeValue.trim() : messageCell.innerText.trim();
                    const textLower = messageText.toLowerCase();
                    const textCyrillicTranslit = convertTranslitToСyrillic(textLower);

                    if (!isMessageWithin24Hours(timeText)) continue;

                    let matchedToxicity = toxicityKeywords.find(kw => textLower.includes(kw) || textCyrillicTranslit.includes(kw));
                    let matchedRacism = racismKeywords.find(kw => textLower.includes(kw) || textCyrillicTranslit.includes(kw));

                    if (matchedToxicity) {
                        counts.toxicity += 1;
                        if (!firstViolation) {
                            firstViolation = {
                                type: "toxicity",
                                text: messageText,
                                time: timeText,
                                word: matchedToxicity
                            };
                        }
                        continue;
                    }

                    if (matchedRacism) {
                        counts.racism += 1;
                        if (!firstViolation || firstViolation.type !== "toxicity") {
                            if (!firstViolation || firstViolation.type !== "racism") {
                                firstViolation = {
                                    type: "racism",
                                    text: messageText,
                                    time: timeText,
                                    word: matchedRacism
                                };
                            }
                        }
                    }

                    const highlightedElements = messageCell.querySelectorAll('span, mark, div, strong, [class*="badge"], [class*="word"]');
                    let siteHighlightedWord = "";
                    let detectedColorType = "";

                    for (const el of highlightedElements) {
                        const style = window.getComputedStyle(el);
                        const bg = style.backgroundColor;
                        const className = el.className ? el.className.toLowerCase() : "";

                        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && !bg.includes('rgba(0, 0, 0, 0)')) {
                            siteHighlightedWord = el.innerText.trim();

                            if (bg.includes('239, 68, 68') || bg.includes('255, 77, 77') || className.includes('danger') || className.includes('heavy') || className.includes('red')) {
                                detectedColorType = "heavy";
                            } else if (bg.includes('245, 158, 11') || bg.includes('255, 204, 0') || className.includes('warning') || className.includes('medium') || className.includes('yellow') || className.includes('orange')) {
                                detectedColorType = "medium";
                            } else if (bg.includes('59, 130, 246') || className.includes('info') || className.includes('light') || className.includes('blue')) {
                                detectedColorType = "light";
                            }
                            break;
                        }
                    }

                    if (siteHighlightedWord) {
                        if (detectedColorType === "heavy") {
                            counts.heavy += 1;
                            if (!firstViolation) {
                                firstViolation = { type: "heavy", text: messageText, time: timeText, word: siteHighlightedWord };
                            }
                        } else if (detectedColorType === "medium") {
                            counts.medium += 1;
                            if (!firstViolation) {
                                firstViolation = { type: "medium", text: messageText, time: timeText, word: siteHighlightedWord };
                            }
                        } else if (detectedColorType === "light") {
                            counts.light += 1;
                            if (!firstViolation) {
                                firstViolation = { type: "light", text: messageText, time: timeText, word: siteHighlightedWord };
                            }
                        }
                    }
                }
            }

            let finalReason = "";
            let finalDuration = "";
            let finalTrigger = "";
            let finalMsg = "";

            if (counts.toxicity >= 1) {
                finalReason = "Токсичность";
                finalDuration = "12 часов";
                const v = (firstViolation && firstViolation.type === "toxicity") ? firstViolation : { word: "токсичность", text: "токсичное сообщение" };
                finalTrigger = v.word;
                finalMsg = v.text;
            } else if (counts.racism >= 2) {
                finalReason = "Расизм/дискриминация";
                finalDuration = "3 дня";
                const v = (firstViolation && firstViolation.type === "racism") ? firstViolation : { word: "расизм", text: "расистское сообщение" };
                finalTrigger = v.word;
                finalMsg = v.text;
            } else if (counts.heavy >= 3) {
                finalReason = "Расизм/дискриминация";
                finalDuration = "3 дня";
                finalTrigger = firstViolation ? firstViolation.word : "триггер";
                finalMsg = firstViolation ? firstViolation.text : "";
            } else if (counts.medium >= 3) {
                finalReason = "Оскорбление";
                finalDuration = "6 часов";
                finalTrigger = firstViolation ? firstViolation.word : "триггер";
                finalMsg = firstViolation ? firstViolation.text : "";
            } else if (counts.light >= 3) {
                finalReason = "Спам в микрофон/чат";
                finalDuration = "6 часов";
                finalTrigger = firstViolation ? firstViolation.word : "триггер";
                finalMsg = firstViolation ? firstViolation.text : "";
            }

            if (!finalReason) {
                let statusText = "✅ <b>Проверка:</b> Нарушений не обнаружено (критерии для выдачи наказания не достигнуты).";
                if (counts.racism === 1 || counts.medium > 0 || counts.light > 0 || counts.heavy > 0) {
                    statusText += `<br><span style="font-size:11px; opacity:0.8;">Текущая активность: Расизм: ${counts.racism}/2, Оск/Провокации (Medium): ${counts.medium}/3, Спам (Light): ${counts.light}/3</span>`;
                }
                updateInfoBadge('helper-suggest-badge', 'background: #14532d; border-left: 4px solid #22c55e; color: #bbf7d0;', statusText, textarea);
                return;
            }

            const dupCheck = checkAndRegisterPunishment(steamId, finalMsg);
            if (dupCheck.isDuplicate) {
                updateInfoBadge('helper-suggest-badge', 'background: #7c2d12; border-left: 4px solid #f97316; color: #ffedd5;', `🚨 <b>Повторный репорт:</b> За текст "${finalMsg}" игроку уже выдавался мут за последние 24 часа.`, textarea);
                return;
            }

            updateInfoBadge('helper-suggest-badge', 'background: #141726; border-left: 4px solid #64748b; color: #ffffff;', `💡 <b>Рекомендуемое наказание:</b> Нарушены условия выдачи мута.<br>Обнаружен триггер <u>${finalTrigger}</u> в сообщении "${finalMsg}".<br>Причина: <b>${finalReason}</b><br>Рекомендуется выдать: <b>Чат + Микрофон</b> на <b>${finalDuration}</b>.`, textarea);

            const submitButton = document.querySelector('button[type="submit"]') || document.querySelector('.js-submit-punishment');
            if (submitButton) {
                submitButton.onclick = function () { dupCheck.register(); };
            }
        }

        function createPanel(templates, target, panelId) {
            const panel = document.createElement('div');
            panel.id = panelId;
            panel.style.cssText = "display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; z-index: 9999; align-items: center;";
            
            Object.entries(templates).forEach(([name, text]) => {
                const btn = document.createElement('button');
                btn.innerText = name;
                btn.style.cssText = "background: #64748b; color: white; border: none; padding: 4px 8px; cursor: pointer; border-radius: 3px; font-size: 12px;";
                btn.onclick = (e) => {
                    e.preventDefault();
                    
                    const currentText = target.value.trim();
                    if (currentText === "") {
                        target.value = text;
                    } else {
                        if (!currentText.includes(text)) {
                            target.value = currentText + " " + text;
                        }
                    }

                    target.dispatchEvent(new Event('input', { bubbles: true }));
                };
                panel.appendChild(btn);
            });

            if (panelId === 'mod-ticket-panel') {
                const copyBtn = document.createElement('button');
                copyBtn.innerText = "📋 Копировать ник";
                copyBtn.style.cssText = "background: #475569; color: white; border: none; padding: 4px 8px; cursor: pointer; border-radius: 3px; font-size: 12px; margin-left: auto; font-weight: bold;";
                copyBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    let nickname = "";

                    const violatorLabel = Array.from(document.querySelectorAll('span, div, td'))
                        .find(el => el.innerText && el.innerText.trim() === 'Нарушитель');

                    if (violatorLabel) {
                        const parent = violatorLabel.parentElement;
                        const playerCard = parent ? parent.querySelector('[data-player-card="true"]') : null;
                        if (playerCard) {
                            const nameSpan = playerCard.querySelector('button span, span');
                            if (nameSpan) {
                                nickname = nameSpan.innerText.trim();
                            }
                        }
                    }

                    if (!nickname) {
                        const suspectBlock = document.querySelector('.player-nickname') || document.querySelector('.ticket-suspect');
                        if (suspectBlock) {
                            nickname = suspectBlock.innerText.replace(/Тикет|Нарушитель|Подозреваемый/gi, '').replace(/#\d+/g, '').trim();
                        }
                    }

                    if (nickname) {
                        const el = document.createElement('textarea');
                        el.value = nickname;
                        el.style.position = 'absolute';
                        el.style.left = '-9999px';
                        document.body.appendChild(el);
                        el.select();
                        try {
                            document.execCommand('copy');
                            const originalText = copyBtn.innerText;
                            copyBtn.innerText = `✅ ${nickname}`;
                            copyBtn.style.background = "#16a34a";
                            setTimeout(() => {
                                copyBtn.innerText = originalText;
                                copyBtn.style.background = "#475569";
                            }, 1500);
                        } catch (err) {
                            console.error('Не вдалося скопіювати:', err);
                        }
                        document.body.removeChild(el);
                    }
                };
                panel.appendChild(copyBtn);
            }

            return panel;
        }

        function runDOMUpdates() {
            if (observer) observer.disconnect();

            runChatTranslation();

            const textareas = document.querySelectorAll('textarea');
            textareas.forEach(textarea => {
                let parent = textarea.parentElement;
                let isNotificationModal = false;

                while (parent && parent !== document.body) {
                    if (parent.innerText && (parent.innerText.includes('Отправить уведомление') || parent.innerText.includes('Уведомление игрока') || parent.innerText.includes('Уведомить'))) {
                        isNotificationModal = true;
                        break;
                    }
                    parent = parent.parentElement;
                }

                if (isNotificationModal) {
                    if (!document.getElementById('mod-notif-panel')) {
                        const panel = createPanel(templatesNotif, textarea, 'mod-notif-panel');
                        textarea.parentNode.insertBefore(panel, textarea);
                    }
                } else {
                    const placeholder = textarea.placeholder || '';
                    if (placeholder.includes('детали') || placeholder.includes('Опишите') || textarea.closest('form')) {
                        if (!document.getElementById('mod-ticket-panel')) {
                            const panel = createPanel(templatesTicket, textarea, 'mod-ticket-panel');
                            textarea.parentNode.insertBefore(panel, textarea);
                        }

                        processTicketRules(textarea);
                    }
                }
            });

            const rows = document.querySelectorAll('tr');
            rows.forEach(row => {
                if (row.innerText && row.innerText.includes('CYBERSHOKE:')) {
                    const fullText = row.innerText;
                    const match = fullText.match(/CYBERSHOKE:\s*(\d+)/i);
                    if (match) {
                        const hours = parseInt(match[1], 10);

                        if (hours < 50) {
                            const actionBtn = row.querySelector('button') || row.querySelector('a[href*="ticket"]');
                            if (actionBtn && !row.querySelector('.cs-new-badge')) {
                                const badge = document.createElement('span');
                                badge.className = 'cs-new-badge';
                                badge.innerText = '[NEW ACC]';
                                badge.style.cssText = "color: #ffcc00; font-weight: bold; font-size: 11px; margin-right: 8px; display: inline-block; vertical-align: middle; background: rgba(255, 204, 0, 0.2); padding: 2px 6px; border-radius: 3px; border: 1px solid #ffcc00;";
                                actionBtn.parentNode.insertBefore(badge, actionBtn);
                            }
                        }
                    }
                }
            });

            const treeWalkerIP = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let ipNode;
            while (ipNode = treeWalkerIP.nextNode()) {
                if (ipNode.nodeValue && ipRegex.test(ipNode.nodeValue)) {
                    const el = ipNode.parentElement;
                    if (el && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' && !el.closest('.card') && !el.dataset.ipWrapperSetup) {
                        const ipMatch = ipNode.nodeValue.match(ipRegex);
                        if (!ipMatch) continue;

                        const rawIp = ipMatch[0];
                        el.dataset.ipWrapperSetup = "true";

                        el.style.setProperty("display", "inline-flex", "important");
                        el.style.setProperty("align-items", "center", "important");
                        el.style.setProperty("gap", "6px", "important");
                        el.style.setProperty("padding", "2px 6px", "important");
                        el.style.setProperty("border-radius", "4px", "important");
                        el.style.setProperty("transition", "all 0.15s ease", "important");

                        const checkboxBadge = document.createElement('span');
                        checkboxBadge.className = 'ip-manual-indicator';
                        checkboxBadge.style.cssText = "display: inline-block; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #555555; background: transparent; transition: all 0.15s ease; flex-shrink: 0; cursor: pointer;";
                        el.insertBefore(checkboxBadge, el.firstChild);

                        const updateVisuals = () => {
                            const currentStatus = getStoredIPStatus(rawIp);
                            if (currentStatus === 'working') {
                                el.style.setProperty("background-color", "rgba(34, 197, 94, 0.15)", "important");
                                el.style.setProperty("color", "#22c55e", "important");
                                checkboxBadge.style.setProperty("border-color", "#22c55e", "important");
                                checkboxBadge.style.setProperty("background-color", "#22c55e", "important");
                            } else if (currentStatus === 'broken') {
                                el.style.setProperty("background-color", "rgba(239, 68, 68, 0.15)", "important");
                                el.style.setProperty("color", "#ef4444", "important");
                                checkboxBadge.style.setProperty("border-color", "#ef4444", "important");
                                checkboxBadge.style.setProperty("background-color", "#ef4444", "important");
                            } else {
                                el.style.removeProperty("background-color");
                                el.style.removeProperty("color");
                                checkboxBadge.style.setProperty("border-color", "#555555", "important");
                                checkboxBadge.style.setProperty("background-color", "transparent", "important");
                            }
                        };

                        checkboxBadge.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();

                            const currentStatus = getStoredIPStatus(rawIp);

                            if (e.ctrlKey) {
                                if (currentStatus === 'broken') {
                                    setStoredIPStatus(rawIp, null);
                                } else {
                                    setStoredIPStatus(rawIp, 'broken');
                                }
                            } else {
                                if (currentStatus === 'working') {
                                    setStoredIPStatus(rawIp, null);
                                } else {
                                    setStoredIPStatus(rawIp, 'working');
                                }
                            }
                            updateVisuals();
                        });

                        updateVisuals();
                    }
                }
            }

            if (observer) {
                observer.observe(document.documentElement, { childList: true, subtree: true });
            }
        }

        setInterval(() => {
            document.querySelectorAll('button').forEach(btn => {
                if (btn.innerText && btn.innerText.includes('Обновить')) {
                    btn.addEventListener('click', () => {
                        setTimeout(runDOMUpdates, 500);
                    });
                }
            });
        }, 1000);

        observer = new MutationObserver(() => {
            runDOMUpdates();
        });
        runDOMUpdates();
    }
})();