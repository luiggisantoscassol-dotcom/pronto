// CONFIGURAÇÃO SUPABASE
const SUPABASE_URL = 'https://xbrvbsiatwxcmnssaxwe.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_CWvQLBuFfWih-VxxqZT9XQ_lg6zARGR';

document.addEventListener('DOMContentLoaded', () => {
    const goalCards = document.querySelectorAll('.goal-card');
    const timeGrid = document.getElementById('time-grid');
    const nameInput = document.getElementById('name');
    const whatsappBtn = document.getElementById('whatsapp-btn');
    const dateSelector = document.getElementById('date-selector');
    const heroCta = document.getElementById('hero-cta');
    const phoneInput = document.getElementById('phone');
    
    if (heroCta) {
        heroCta.addEventListener('click', () => navigateToSection('#agendar', 'forward'));
    }

    // Lógica do Botão Compartilhar / Indicar via WhatsApp Direto
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
            const urlSite = 'https://www.tfbox.com.br/';
            const mensagem = `Opa! Dá uma olhada no treino da TFBOX. Eles estão com aulas experimentais gratuitas, agende a sua por aqui: ${urlSite}`;
            
            // Link direto para compartilhamento no WhatsApp
            const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(mensagem)}`;
            
            logEvent('share_whatsapp_click', urlSite);
            
            // Abrir em nova aba
            window.open(whatsappUrl, '_blank');
        });
    }

    // Limpar o hash da URL ao carregar para evitar pulos automáticos ao atualizar
    if (window.location.hash) {
        window.history.replaceState('', document.title, window.location.pathname + window.location.search);
    }

    // Lógica de Scroll antigo removida (Estilo App não usa scroll global)

    document.querySelectorAll('.back-step-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-back');
            
            // Se for o botão de mudar data, esconde ele ao clicar
            if (btn.classList.contains('small-back')) {
                btn.classList.remove('visible');
            }
            
            navigateToSection(target, 'backward');
        });
    });

    // Máscara para o telefone
    if (phoneInput) {
        phoneInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 11) value = value.slice(0, 11);
            
            if (value.length > 10) {
                value = value.replace(/^(\d{2})(\d{5})(\d{4}).*/, '($1) $2-$3');
            } else if (value.length > 6) {
                value = value.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, '($1) $2-$3');
            } else if (value.length > 2) {
                value = value.replace(/^(\d{2})(\d{0,5}).*/, '($1) $2');
            } else if (value.length > 0) {
                value = value.replace(/^(\d*)/, '($1');
            }
            e.target.value = value;
        });
    }
    
    let selectedGoal = '';
    let selectedDate = '';
    let selectedDayIndex = -1;
    let selectedTime = '';
    let selectedProfessor = '';
    let existingBookings = [];

    let supabase = null;
    const isSupabaseConfigured = SUPABASE_URL && SUPABASE_URL !== 'YOUR_SUPABASE_URL' && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('YOUR_');

    if (window.supabase && isSupabaseConfigured) {
        try {
            supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        } catch (e) { console.error(e); }
    }

    const schedule = {
        morning: [
            { time: '06:15', professor: 'Prof. João', days: [1, 2, 3, 5] },
            { time: '08:15', professor: 'Prof. Alexandre', days: [1, 2, 5] },
            { time: '08:15', professor: 'Prof. João', days: [3] }
        ],
        afternoon: [
            { time: '16:30', professor: 'Prof. Bruno', days: [1, 2, 3, 4, 5] },
            { time: '17:15', professor: 'Prof. Bruno', days: [1, 2, 3, 4, 5] },
            { time: '18:00', professor: 'Prof. Bruno', days: [1, 2, 3, 4, 5] },
            { time: '18:45', professor: 'Prof. Bruno', days: [1, 2, 3, 4, 5] },
            { time: '19:30', professor: 'Prof. Bruno', days: [1, 2, 3, 4, 5] }
        ]
    };

    const navigateToSection = (targetSelector, direction = 'forward') => {
        const currentActive = document.querySelector('section.active');
        const nextSection = document.querySelector(targetSelector);
        
        if (!nextSection || currentActive === nextSection) return;

        // Limpar animações anteriores
        nextSection.classList.remove('slide-in-right', 'slide-in-left', 'slide-out-left', 'slide-out-right', 'fade-in');
        if (currentActive) {
            currentActive.classList.remove('slide-in-right', 'slide-in-left', 'slide-out-left', 'slide-out-right', 'fade-in');
        }

        if (direction === 'forward') {
            if (currentActive) currentActive.classList.add('slide-out-left');
            nextSection.classList.add('active', 'slide-in-right');
        } else {
            if (currentActive) currentActive.classList.add('slide-out-right');
            nextSection.classList.add('active', 'slide-in-left');
        }

        // Cleanup após a animação (0.6s definido no CSS)
        setTimeout(() => {
            if (currentActive && currentActive !== nextSection) {
                currentActive.classList.remove('active', 'slide-out-left', 'slide-out-right');
            }
        }, 600);
        
        // Garantir que a nova seção comece no topo
        nextSection.scrollTop = 0;

        // Atualizar Barra de Progresso
        updateProgress(targetSelector);
    };

    const updateProgress = (targetId) => {
        const progressBar = document.getElementById('progress-bar');
        const dots = document.querySelectorAll('.step-dot');
        const sections = ['hero', 'agendar', 'date-section', 'time-section', 'dados-section'];
        
        const cleanId = targetId.replace('#', '').replace('.', '');
        const currentIndex = sections.indexOf(cleanId);
        
        if (currentIndex !== -1) {
            const progress = (currentIndex / (sections.length - 1)) * 100;
            if (progressBar) progressBar.style.width = `${progress}%`;
            
            dots.forEach((dot, index) => {
                if (index <= currentIndex) {
                    dot.classList.add('active');
                } else {
                    dot.classList.remove('active');
                }
            });
        }
    };

    // 1. GERAÇÃO DE DATAS (MÊS INTEIRO)
    const generateDates = () => {
        const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        if (!dateSelector) return;
        dateSelector.innerHTML = '';
        
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const lastDay = new Date(year, month + 1, 0).getDate();
        
        for (let i = now.getDate() + 1; i <= lastDay; i++) {
            const date = new Date(year, month, i);
            if (date.getDay() === 0 || date.getDay() === 6) continue;

            const dayName = days[date.getDay()];
            const dayNum = date.getDate();
            const monthName = date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
            const dateString = `${dayName}, ${dayNum} de ${monthName}`;
            
            const card = document.createElement('div');
            card.className = 'date-card';
            card.id = `date-${dayNum}`;
            card.innerHTML = `
                <div class="selection-indicator"></div>
                <span>${dayName}</span>
                <strong>${dayNum}</strong>
            `;
            
            card.addEventListener('click', () => {
                document.querySelectorAll('.date-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                selectedDate = dateString;
                selectedDayIndex = date.getDay();
                selectedTime = '';
                updateTimeUI();
                
                // Delay reforçado para ver a animação do check
                setTimeout(() => {
                    navigateToSection('#time-section', 'forward');
                }, 500);
            });
            
            dateSelector.appendChild(card);
        }
    };

    const updateDateAvailabilityUI = () => {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const lastDay = new Date(year, month + 1, 0).getDate();

        for (let i = now.getDate() + 1; i <= lastDay; i++) {
            const date = new Date(year, month, i);
            if (date.getDay() === 0 || date.getDay() === 6) continue;

            const dayName = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][date.getDay()];
            const monthName = date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
            const dateString = `${dayName}, ${i} de ${monthName}`;
            
            const totalSlots = [...schedule.morning, ...schedule.afternoon].filter(s => s.days.includes(date.getDay())).length * 2;
            const takenSlots = existingBookings.filter(b => b.booking_date === dateString).length;
            const available = totalSlots - takenSlots;

            const card = document.getElementById(`date-${i}`);
            if (card) {
                if (available <= 0) {
                    card.classList.add('disabled');
                    card.style.opacity = '0.2';
                    card.style.pointerEvents = 'none';
                    card.style.filter = 'grayscale(1)';
                } else {
                    card.classList.remove('disabled');
                    card.style.opacity = '1';
                    card.style.pointerEvents = 'auto';
                    card.style.filter = 'none';
                }
            }
        }
    };

    const updateTimeUI = () => {
        if (selectedDayIndex === -1 || !timeGrid) return;
        timeGrid.innerHTML = '';
        const availableSlots = [];
        [...schedule.morning, ...schedule.afternoon].forEach(slot => {
            if (slot.days.includes(selectedDayIndex)) availableSlots.push(slot);
        });

        availableSlots.forEach(slot => {
            const vagas = getSlotVagas(selectedDate, slot.time);
            const isAvailable = vagas > 0;
            const card = document.createElement('div');
            card.className = `time-card ${!isAvailable ? 'disabled' : ''}`;
            
            if (!isAvailable) {
                card.style.opacity = '0.3';
                card.style.pointerEvents = 'none';
            }
            
            card.innerHTML = `
                <div class="time-content">
                    <div class="time-header">
                        <h4>${slot.time}</h4>
                        <span class="vagas-count ${vagas === 1 ? 'last-vaga' : ''}">${isAvailable ? `${vagas} ${vagas === 1 ? 'vaga' : 'vagas'}` : 'LOTADO'}</span>
                    </div>
                    <span class="professor">${slot.professor}</span>
                </div>
                <div class="selection-indicator"></div>
            `;

            card.addEventListener('click', (e) => {
                if (!isAvailable) return;
                
                // Forçar remoção de classes e seleção
                document.querySelectorAll('.time-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                
                selectedTime = slot.time;
                selectedProfessor = slot.professor;
                
                // Pequeno delay para ver a animação do check
                setTimeout(() => {
                    navigateToSection('#dados-section', 'forward');
                }, 400);
                
                // Feedback tátil/visual imediato para mobile
                if (window.navigator.vibrate) window.navigator.vibrate(10);
                
                // Focar no nome após o scroll ter terminado completamente
                setTimeout(() => {
                    const nameInput = document.getElementById('name');
                    if (nameInput) nameInput.focus();
                }, 1000);
            }, { passive: false });
            timeGrid.appendChild(card);
        });
    };

    const getSlotVagas = (date, time) => {
        if (!existingBookings) return 2;
        const bookings = existingBookings.filter(b => b.booking_date === date && b.shift === time);
        return Math.max(0, 2 - bookings.length);
    };



    whatsappBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        const phone = phoneInput ? phoneInput.value.trim() : '';
        
        // Reset errors
        nameInput.classList.remove('error');
        if (phoneInput) phoneInput.classList.remove('error');
        document.querySelectorAll('.goals-grid, .date-selector, .time-grid').forEach(el => {
            el.classList.remove('error-container');
        });

        // Validação hierárquica
        if (!selectedGoal) {
            navigateToSection('#agendar', 'backward');
            const el = document.querySelector('.goals-grid');
            el.classList.add('error-container');
            el.addEventListener('click', () => el.classList.remove('error-container'), { once: true });
            return;
        }
        if (!selectedDate) {
            navigateToSection('#date-section', 'backward');
            const el = document.querySelector('.date-selector');
            el.classList.add('error-container');
            el.addEventListener('click', () => el.classList.remove('error-container'), { once: true });
            return;
        }
        if (!selectedTime) {
            navigateToSection('#time-section', 'backward');
            const el = document.querySelector('.time-grid');
            el.classList.add('error-container');
            el.addEventListener('click', () => el.classList.remove('error-container'), { once: true });
            return;
        }
        if (!name) {
            nameInput.classList.add('error');
            nameInput.focus();
            nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            nameInput.addEventListener('input', () => nameInput.classList.remove('error'), { once: true });
            return;
        }
        if (phoneInput && phone.length < 14) { // (00) 00000-0000
            phoneInput.classList.add('error');
            phoneInput.focus();
            phoneInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            phoneInput.addEventListener('input', () => phoneInput.classList.remove('error'), { once: true });
            return;
        }

        whatsappBtn.innerText = 'PROCESSANDO...';
        whatsappBtn.disabled = true;
        try {
            if (supabase) {
                // 1. Verificar se este telefone já tem ALGUM agendamento (Regra de Agendamento Único)
                const { data: userBookings, error: checkUserError } = await supabase
                    .from('bookings')
                    .select('id')
                    .eq('phone', phone)
                    .limit(1);

                if (userBookings && userBookings.length > 0) {
                    alert('Você já possui uma aula experimental agendada! Cada aluno tem direito a apenas uma aula gratuita.');
                    whatsappBtn.innerText = 'RESERVAR MINHA VAGA';
                    whatsappBtn.disabled = false;
                    return;
                }

                // 2. Verificar lotação real do horário escolhido
                const { data: existing, error: countError } = await supabase
                    .from('bookings')
                    .select('*')
                    .eq('booking_date', selectedDate)
                    .eq('shift', selectedTime);
                
                if (existing && existing.length >= 2) {
                    alert('Este horário acabou de lotar! Por favor, escolha outro.');
                    await fetchAllBookings();
                whatsappBtn.innerText = 'RESERVAR MINHA VAGA';
                whatsappBtn.disabled = false;
                return;
            }

            console.log('Tentando inserir:', { name, phone, goal: selectedGoal, booking_date: selectedDate, shift: selectedTime });
            const { error: insertError } = await supabase.from('bookings').insert([{ 
                name, 
                phone, 
                goal: selectedGoal, 
                booking_date: selectedDate, 
                shift: selectedTime,
                device: getDeviceInfo() // Novo campo de rastreio
            }]);

            if (insertError) {
                console.error('Erro na inserção:', insertError);
                throw insertError;
            }
            console.log('Inserção bem-sucedida no Banco de Dados!');
            logEvent('whatsapp_click', `Vaga: ${selectedDate} ${selectedTime}`); // LOG DE CONVERSÃO
        }
        const message = `🔥 *NOVO AGENDAMENTO - TFBOX* 🔥\n\nOlá! Acabei de agendar minha aula experimental pelo site:\n\n👤 *NOME:* ${name}\n📱 *CONTATO:* ${phone}\n🎯 *FOCO:* ${selectedGoal}\n📅 *DATA:* ${selectedDate}\n🕒 *HORÁRIO:* ${selectedTime}\n👨‍🏫 *PROFESSOR:* ${selectedProfessor}\n\nAguardo a confirmação! 🚀`;
        
        // Dispara o evento de Lead no Meta Pixel
        if (window.fbq) {
            window.fbq('track', 'Lead', {
                content_name: selectedGoal,
                content_category: 'Agendamento Experimental'
            });
        }
        
        // Redirecionamento síncrono para evitar bloqueio de pop-up/redirect pelo navegador
        window.location.href = `https://wa.me/555192438029?text=${encodeURIComponent(message)}`;
        
        whatsappBtn.innerText = 'RESERVA CONCLUÍDA!';
    } catch (err) { alert('Erro no agendamento.'); whatsappBtn.innerText = 'RESERVAR MINHA VAGA'; whatsappBtn.disabled = false; }
});

    const fetchAllBookings = async () => {
        if (!supabase) {
            updateDateAvailabilityUI();
            return;
        }
        try {
            const { data, error } = await supabase.from('bookings').select('booking_date, shift');
            if (error) throw error;
            existingBookings = data || [];
            updateDateAvailabilityUI();
            if (selectedDate) updateTimeUI(); // Atualizar horários se estiver neles
        } catch (err) { console.error(err.message); updateDateAvailabilityUI(); }
    };

    // --- RASTREIO E ANALYTICS ---
    const sessionId = Math.random().toString(36).substring(7);
    const getDeviceInfo = () => {
        const ua = navigator.userAgent;
        if (/iPhone|iPad|iPod/.test(ua)) return "iPhone";
        if (/Android/.test(ua)) return "Android";
        if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return "Tablet";
        if (/Mobile/.test(ua)) return "Mobile";
        return "Desktop";
    };

    const logEvent = async (type, data = '') => {
        if (!supabase) return;
        try {
            // Simplificação do nome do navegador
            const ua = navigator.userAgent;
            let browser = "Outro";
            if (ua.includes("Firefox")) browser = "Firefox";
            else if (ua.includes("SamsungBrowser")) browser = "Samsung Browser";
            else if (ua.includes("Opera") || ua.includes("OPR")) browser = "Opera";
            else if (ua.includes("Trident")) browser = "IE";
            else if (ua.includes("Edge")) browser = "Edge";
            else if (ua.includes("Chrome")) browser = "Chrome";
            else if (ua.includes("Safari")) browser = "Safari";

            await supabase.from('visitor_logs').insert([{
                session_id: sessionId,
                event_type: type,
                event_data: data,
                device: getDeviceInfo(),
                browser: browser
            }]);
        } catch (e) { console.error('Erro log:', e); }
    };

    // Log inicial
    logEvent('page_view', window.location.pathname);

    // --- REALTIME ---
    if (supabase) {
        supabase.channel('db-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
                console.log('Mudança detectada no banco! Atualizando vagas...');
                fetchAllBookings();
            })
            .subscribe();
    }

    // Ajuste inteligente para teclado mobile
    let originalHeight = window.innerHeight;
    
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            originalHeight = window.innerHeight;
        }, 500);
    });
    
    const fixLayout = () => {
        // Reset absoluto de todos os níveis de scroll possíveis para evitar que o teclado
        // desloque o layout de forma permanente no mobile
        window.scrollTo(0, 0);
        document.body.scrollTop = 0;
        document.documentElement.scrollTop = 0;
        
        const activeSection = document.querySelector('section.active');
        if (activeSection) {
            activeSection.scrollTop = 0;
            // Reflow mais suave para garantir o reposicionamento dos elementos absolute
            activeSection.style.webkitTransform = 'translateZ(0)';
        }
    };


    // Visual Viewport API - A forma mais precisa de detectar teclado no mobile
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            const isKeyboardClosed = window.visualViewport.height >= originalHeight * 0.85;
            if (isKeyboardClosed) {
                document.body.classList.remove('keyboard-open');
                fixLayout();
                // Tenta resetar novamente em 300ms por segurança
                setTimeout(fixLayout, 300);
            }
        });
    }

    // Gerenciamento de foco unificado
    const handleFocus = () => {
        document.body.classList.add('keyboard-open');
    };

    const handleBlur = () => {
        // Pequeno delay para checar se mudou para outro input ou fechou
        setTimeout(() => {
            if (document.activeElement.tagName !== 'INPUT') {
                document.body.classList.remove('keyboard-open');
                fixLayout();
            }
        }, 100);
    };

    [nameInput, phoneInput].forEach(input => {
        if (input) {
            input.addEventListener('focus', handleFocus);
            input.addEventListener('blur', handleBlur);
        }
    });

    // Reset via focusout (backup)
    document.addEventListener('focusout', (e) => {
        if (e.target.tagName === 'INPUT') {
            setTimeout(fixLayout, 200);
            setTimeout(fixLayout, 400);
        }
    });

    goalCards.forEach(card => {
        card.addEventListener('click', () => {
            goalCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            selectedGoal = card.getAttribute('data-goal');
            logEvent('goal_click', selectedGoal); // LOG
            
            // Delay reforçado para ver a animação do check
            setTimeout(() => {
                navigateToSection('#date-section', 'forward');
            }, 500);
        });
    });

    generateDates();
    fetchAllBookings();
});
