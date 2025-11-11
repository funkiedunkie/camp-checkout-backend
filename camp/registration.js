(function() {
  const DEFAULT_CONFIG = {
    basePrice: 84,
    siblingDiscountRate: 0.1,
    beforeCarePrice: 18,
    afterCarePrice: 25,
    lunchPrice: 6,
    promoCodes: {},
    capacityFunctionUrl: '/.netlify/functions/capacity',
    fallbackCapacity: 40,
    fallbackRegistered: 0,
    stripePublishableKey: '',
    checkoutFunctionUrl: '/.netlify/functions/create-checkout-session',
    successPath: '/camp/success/',
    cancelPath: '/camp/cancelled/',
    campName: 'Camp Registration',
    campDate: '',
    baseProductName: 'Camp',
    beforeCareLabel: 'Before Camp Care',
    afterCareLabel: 'After Camp Care',
    lunchLabel: 'Hot Lunch'
  };

  function mergeConfig(userConfig = {}) {
    const {
      capacity = {},
      stripe = {},
      labels = {},
      promoCodes,
      ...rest
    } = userConfig || {};

    const config = { ...DEFAULT_CONFIG, ...rest };
    config.promoCodes = promoCodes ? { ...promoCodes } : { ...DEFAULT_CONFIG.promoCodes };

    if (capacity && typeof capacity === 'object') {
      if (typeof capacity.functionUrl === 'string') config.capacityFunctionUrl = capacity.functionUrl;
      if (capacity.fallbackCapacity != null) config.fallbackCapacity = capacity.fallbackCapacity;
      if (capacity.fallbackRegistered != null) config.fallbackRegistered = capacity.fallbackRegistered;
    }

    if (stripe && typeof stripe === 'object') {
      if (typeof stripe.publishableKey === 'string') config.stripePublishableKey = stripe.publishableKey;
      if (typeof stripe.checkoutFunctionUrl === 'string') config.checkoutFunctionUrl = stripe.checkoutFunctionUrl;
      if (stripe.successUrl) config.successUrl = stripe.successUrl;
      if (stripe.cancelUrl) config.cancelUrl = stripe.cancelUrl;
      if (stripe.successPath) config.successPath = stripe.successPath;
      if (stripe.cancelPath) config.cancelPath = stripe.cancelPath;
    }

    if (labels && typeof labels === 'object') {
      if (labels.beforeCare) config.beforeCareLabel = labels.beforeCare;
      if (labels.afterCare) config.afterCareLabel = labels.afterCare;
      if (labels.lunch) config.lunchLabel = labels.lunch;
      if (labels.baseProduct) config.baseProductName = labels.baseProduct;
    }

    return config;
  }

  function resolveUrl(value, fallbackPath) {
    const finalValue = value || fallbackPath;
    if (!finalValue) return '';
    if (/^https?:\/\//i.test(finalValue)) return finalValue;
    return `${window.location.origin}${finalValue.startsWith('/') ? finalValue : `/${finalValue}`}`;
  }

  function formatCurrency(amount) {
    const num = Number(amount) || 0;
    return `$${num % 1 === 0 ? num.toFixed(0) : num.toFixed(2)}`;
  }

  window.initCampRegistration = function initCampRegistration(userConfig) {
    const config = mergeConfig(userConfig);
    const start = () => setup(config);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  };

  function setup(config) {
    const BASE_PRICE = Number(config.basePrice || 0);
    const SIBLING_DISCOUNT_RATE = Number(config.siblingDiscountRate || 0);
    const BEFORE_CARE_PRICE = Number(config.beforeCarePrice || 0);
    const AFTER_CARE_PRICE = Number(config.afterCarePrice || 0);
    const LUNCH_PRICE = Number(config.lunchPrice || 0);
    const PROMO_CODES = config.promoCodes || {};

    let CAPACITY = Number(config.fallbackCapacity ?? 0);
    let REGISTERED = Number(config.fallbackRegistered ?? 0);
    let ACTIVE_PROMO_PCT = 0;
    let CAMPER_STATE = {};
    let stripe;

    const successUrl = resolveUrl(config.successUrl, config.successPath);
    const cancelUrl = resolveUrl(config.cancelUrl, config.cancelPath);

    const numSel = document.getElementById('numCampers');
    const campersContainer = document.getElementById('campersContainer');
    const checkoutButton = document.getElementById('checkoutButton');

    if (!numSel || !campersContainer || !checkoutButton) {
      console.warn('initCampRegistration: required DOM elements were not found.');
      return;
    }

    document.getElementById('promoMsg')?.textContent = '';

    if (config.stripePublishableKey) {
      stripe = Stripe(config.stripePublishableKey);
    } else {
      console.warn('initCampRegistration: Stripe publishable key missing. Checkout will be disabled.');
    }

    async function loadCapacity() {
      if (!config.capacityFunctionUrl) {
        updateFullness();
        return;
      }

      try {
        const r = await fetch(config.capacityFunctionUrl, { cache: 'no-store' });
        const d = await r.json();
        const paid = Number(d.paid || 0);
        const pending = Number(d.pending || 0);
        REGISTERED = paid + pending;
        if (d.capacity != null) CAPACITY = Number(d.capacity);
        updateFullness();
      } catch (e) {
        console.error('capacity fetch failed', e);
        const text = document.getElementById('fullnessText');
        if (text) text.textContent = 'Capacity unavailable';
      }
    }

    function promoMult() {
      return (100 - (ACTIVE_PROMO_PCT || 0)) / 100;
    }

    function updateFullness() {
      const cappedRegistered = Math.max(0, Math.min(REGISTERED, CAPACITY));
      const fraction = CAPACITY > 0 ? cappedRegistered / CAPACITY : 0;
      const FULLNESS_SHAPE = 3;
      const base = 1 - Math.exp(-FULLNESS_SHAPE * fraction);
      const max = 1 - Math.exp(-FULLNESS_SHAPE * 1);
      const curve = max > 0 ? base / max : 0;
      const pct = Math.round(10 + 90 * curve);
      const left = Math.max(0, CAPACITY - cappedRegistered);

      const text = document.getElementById('fullnessText');
      const bar = document.getElementById('fullnessBar');
      const spots = document.getElementById('spotsText');
      if (text) text.textContent = `${pct}% full`;
      if (bar) bar.style.width = `${pct}%`;
      if (spots) spots.textContent = `${left} spots left`;
    }

    function applyPromo() {
      const code = (document.getElementById('promoCode')?.value || '').trim().toUpperCase();
      const pct = PROMO_CODES[code] || 0;
      ACTIVE_PROMO_PCT = pct;
      const msg = document.getElementById('promoMsg');
      if (pct > 0) {
        if (msg) msg.textContent = `${pct}% off applied.`;
      } else if (code) {
        if (msg) msg.textContent = 'Promo not recognized.';
      } else if (msg) {
        msg.textContent = '';
      }
      updateTotal();
    }

    function buildLineItems() {
      const items = [];
      const num = parseInt(numSel.value, 10) || 0;

      for (let i = 1; i <= num; i++) {
        const firstName = document.querySelector(`[name="childFirst${i}"]`)?.value || 'Camper';
        const lastName = document.querySelector(`[name="childLast${i}"]`)?.value || String(i);
        const isFirst = i === 1;

        let basePrice = BASE_PRICE * (isFirst ? 1 : (1 - SIBLING_DISCOUNT_RATE));
        basePrice *= promoMult();
        items.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${config.baseProductName} - ${firstName} ${lastName}${!isFirst ? ' (Sibling Discount)' : ''}`,
              description: `${config.baseProductName} registration for ${firstName} ${lastName}`
            },
            unit_amount: Math.round(basePrice * 100)
          },
          quantity: 1
        });

        const beforeCare = document.querySelector(`input[data-kind="before"][data-i="${i}"]`);
        if (beforeCare && beforeCare.checked) {
          let amt = BEFORE_CARE_PRICE;
          if (!isFirst) amt *= (1 - SIBLING_DISCOUNT_RATE);
          amt *= promoMult();
          items.push({
            price_data: {
              currency: 'usd',
              product_data: { name: `${config.beforeCareLabel} - ${firstName} ${lastName}` },
              unit_amount: Math.round(amt * 100)
            },
            quantity: 1
          });
        }

        const afterCare = document.querySelector(`input[data-kind="after"][data-i="${i}"]`);
        if (afterCare && afterCare.checked) {
          let amt = AFTER_CARE_PRICE;
          if (!isFirst) amt *= (1 - SIBLING_DISCOUNT_RATE);
          amt *= promoMult();
          items.push({
            price_data: {
              currency: 'usd',
              product_data: { name: `${config.afterCareLabel} - ${firstName} ${lastName}` },
              unit_amount: Math.round(amt * 100)
            },
            quantity: 1
          });
        }

        const lunch = document.querySelector(`input[name="lunch${i}"]:checked`);
        if (lunch && Number(lunch.value) === LUNCH_PRICE) {
          const amt = LUNCH_PRICE * promoMult();
          items.push({
            price_data: {
              currency: 'usd',
              product_data: { name: `${config.lunchLabel} - ${firstName} ${lastName}` },
              unit_amount: Math.round(amt * 100)
            },
            quantity: 1
          });
        }
      }

      return items;
    }

    function gatherRegistrationData() {
      const parentFirstName = document.getElementById('parentFirstName')?.value || '';
      const parentLastName = document.getElementById('parentLastName')?.value || '';
      const billingAddress = document.getElementById('billingAddress')?.value || '';

      const data = {
        parent: {
          firstName: parentFirstName,
          lastName: parentLastName,
          billingAddress
        },
        campers: [],
        total: parseFloat(document.getElementById('total')?.textContent || '0')
      };

      const num = parseInt(numSel.value, 10) || 0;
      for (let i = 1; i <= num; i++) {
        const camper = {
          firstName: document.querySelector(`[name="childFirst${i}"]`)?.value || '',
          lastName: document.querySelector(`[name="childLast${i}"]`)?.value || '',
          birthdate: document.querySelector(`[name="birthdate${i}"]`)?.value || '',
          age: document.querySelector(`[name="childAge${i}"]`)?.value || '',
          careRequired: document.querySelector(`input[name="careReq${i}"]:checked`)?.value === 'yes',
          beforeCare: document.querySelector(`input[data-kind="before"][data-i="${i}"]`)?.checked || false,
          afterCare: document.querySelector(`input[data-kind="after"][data-i="${i}"]`)?.checked || false,
          hotLunch: document.querySelector(`input[name="lunch${i}"]:checked`)?.value === String(LUNCH_PRICE),
          hasAllergies: document.querySelector(`input[name="allergy${i}"]:checked`)?.value === 'yes',
          allergyDetails: document.getElementById(`allergyDetails${i}`)?.value || ''
        };
        data.campers.push(camper);
      }

      return data;
    }

    function renderCamperForms() {
      const num = parseInt(numSel.value, 10) || 0;
      campersContainer.innerHTML = '';

      for (let i = 1; i <= num; i++) {
        const el = document.createElement('div');
        el.className = 'camper-form';
        el.innerHTML = `
          <h2>Camper ${i}</h2>

          <div class="grid two-col">
            <label>Child's First Name
              <input type="text" name="childFirst${i}" />
            </label>
            <label>Child's Last Name
              <input type="text" name="childLast${i}" />
            </label>
          </div>

          <div class="grid two-col">
            <label>Child's Birthdate
              <input type="date" name="birthdate${i}" max="${todayISO()}" />
            </label>
            <label>Child's Age (auto-calculated)
              <input type="text" name="childAge${i}" readonly />
            </label>
          </div>

          <hr />
          <div class="group">
            <strong>Do you require Before or After Camp Care?</strong>
            <div class="options">
              <label class="opt"><input type="radio" name="careReq${i}" value="yes" /> Yes</label>
              <label class="opt"><input type="radio" name="careReq${i}" value="no" checked /> No</label>
            </div>
            <div id="careOptions${i}" class="group hidden">
              <div class="options">
                <label class="opt"><input type="checkbox" data-kind="before" data-i="${i}" value="${BEFORE_CARE_PRICE}" /> ${config.beforeCareLabel} (${formatCurrency(BEFORE_CARE_PRICE)})</label>
                <label class="opt"><input type="checkbox" data-kind="after" data-i="${i}" value="${AFTER_CARE_PRICE}" /> ${config.afterCareLabel} (${formatCurrency(AFTER_CARE_PRICE)})</label>
              </div>
            </div>
          </div>

          <hr />
          <div class="group">
            <strong>${config.lunchLabel}</strong>
            <div class="options">
              <label class="opt"><input type="radio" name="lunch${i}" value="${LUNCH_PRICE}" /> Yes (${formatCurrency(LUNCH_PRICE)})</label>
              <label class="opt"><input type="radio" name="lunch${i}" value="0" checked /> No</label>
            </div>
          </div>

          <hr />
          <div class="group">
            <strong>Allergies and Behavioral Considerations</strong>
            <div class="options">
              <label class="opt"><input type="radio" name="allergy${i}" value="yes" /> Yes</label>
              <label class="opt"><input type="radio" name="allergy${i}" value="no" checked /> No</label>
            </div>
            <textarea
              id="allergyDetails${i}"
              class="hidden"
              placeholder="Please describe any allergies, medical care needs, or behavioral strategies that will help us best support your child at camp."></textarea>
          </div>
        `;
        campersContainer.appendChild(el);
      }

      campersContainer.onchange = (e) => {
        const t = e.target;
        if (!(t instanceof HTMLInputElement)) return;

        if (t.name && t.name.startsWith('careReq')) {
          const idx = t.name.replace('careReq', '');
          const panel = document.getElementById('careOptions' + idx);
          if (!panel) return;
          if (t.value === 'yes') {
            panel.classList.remove('hidden');
          } else {
            panel.classList.add('hidden');
            ['before', 'after'].forEach((kind) => {
              const box = document.querySelector(`input[data-kind="${kind}"][data-i="${idx}"]`);
              if (box) box.checked = false;
            });
          }
        }

        if (t.name && t.name.startsWith('allergy')) {
          const idx = t.name.replace('allergy', '');
          const details = document.getElementById('allergyDetails' + idx);
          if (details) {
            if (t.value === 'yes') details.classList.remove('hidden');
            else details.classList.add('hidden');
          }
        }

        if (t.name && t.name.startsWith('birthdate')) {
          const idx = t.name.replace('birthdate', '');
          const ageField = document.querySelector(`input[name="childAge${idx}"]`);
          if (ageField) ageField.value = calcAge(t.value);
        }

        updateTotal();
      };

      for (let i = 1; i <= num; i++) {
        const bd = document.querySelector(`input[name="birthdate${i}"]`);
        const ageField = document.querySelector(`input[name="childAge${i}"]`);
        if (bd && bd.value && ageField) {
          ageField.value = calcAge(bd.value);
        }
      }

      updateTotal();
    }

    function captureState() {
      const data = {};
      const campers = document.querySelectorAll('.camper-form');
      campers.forEach((_, idx) => {
        const i = idx + 1;
        data[i] = {};
        ['childFirst', 'childLast', 'birthdate', 'childAge'].forEach((field) => {
          const el = document.querySelector(`[name='${field}${i}']`);
          if (el) data[i][field] = el.value;
        });
        const careReq = document.querySelector(`input[name='careReq${i}']:checked`);
        data[i].careReq = careReq ? careReq.value : 'no';
        ['before', 'after'].forEach((kind) => {
          const el = document.querySelector(`input[data-kind='${kind}'][data-i='${i}']`);
          data[i][kind] = el ? !!el.checked : false;
        });
        const lunch = document.querySelector(`input[name='lunch${i}']:checked`);
        data[i].lunch = lunch ? lunch.value : '0';
        const allergy = document.querySelector(`input[name='allergy${i}']:checked`);
        data[i].allergy = allergy ? allergy.value : 'no';
        const allergyDetails = document.getElementById('allergyDetails' + i);
        data[i].allergyDetails = allergyDetails ? allergyDetails.value : '';
      });
      return data;
    }

    function applyState(prev) {
      if (!prev) return;
      const num = parseInt(numSel.value, 10) || 0;
      for (let i = 1; i <= num; i++) {
        const p = prev[i];
        if (!p) continue;
        setVal(`childFirst${i}`, p.childFirst || '');
        setVal(`childLast${i}`, p.childLast || '');
        setVal(`birthdate${i}`, p.birthdate || '');
        const ageField = document.querySelector(`input[name='childAge${i}']`);
        if (ageField) ageField.value = p.childAge || (p.birthdate ? calcAge(p.birthdate) : '');

        checkRadio(`careReq${i}`, p.careReq || 'no');
        const panel = document.getElementById('careOptions' + i);
        if (panel) {
          if (p.careReq === 'yes') panel.classList.remove('hidden');
          else panel.classList.add('hidden');
        }
        setCheckbox('before', i, !!p.before);
        setCheckbox('after', i, !!p.after);
        checkRadio(`lunch${i}`, p.lunch || '0');
        checkRadio(`allergy${i}`, p.allergy || 'no');
        const details = document.getElementById('allergyDetails' + i);
        if (details) {
          details.value = p.allergyDetails || '';
          if (p.allergy === 'yes') details.classList.remove('hidden');
          else details.classList.add('hidden');
        }
      }
    }

    function setVal(name, val) {
      const el = document.querySelector(`[name='${name}']`);
      if (el) el.value = val;
    }

    function checkRadio(name, value) {
      const el = document.querySelector(`input[name='${name}'][value='${value}']`);
      if (el) el.checked = true;
    }

    function setCheckbox(kind, idx, checked) {
      const el = document.querySelector(`input[data-kind='${kind}'][data-i='${idx}']`);
      if (el) el.checked = !!checked;
    }

    function todayISO() {
      const d = new Date();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${m}-${day}`;
    }

    function calcAge(isoDate) {
      if (!isoDate) return '';
      const today = new Date();
      const bd = new Date(isoDate);
      let age = today.getFullYear() - bd.getFullYear();
      const m = today.getMonth() - bd.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
      return Number.isNaN(age) ? '' : String(age);
    }

    function updateTotal() {
      let total = 0;
      let discountSaved = 0;
      const num = parseInt(numSel.value, 10) || 0;

      for (let i = 1; i <= num; i++) {
        const isFirst = i === 1;

        let price = BASE_PRICE * (isFirst ? 1 : (1 - SIBLING_DISCOUNT_RATE));
        if (!isFirst) discountSaved += BASE_PRICE * SIBLING_DISCOUNT_RATE;
        price *= promoMult();
        total += price;

        const careReqYes = document.querySelector(`input[name="careReq${i}"][value="yes"]:checked`);
        if (careReqYes) {
          const before = document.querySelector(`input[data-kind="before"][data-i="${i}"]`);
          const after = document.querySelector(`input[data-kind="after"][data-i="${i}"]`);

          if (before && before.checked) {
            let amt = BEFORE_CARE_PRICE;
            if (!isFirst) {
              const saved = amt * SIBLING_DISCOUNT_RATE;
              discountSaved += saved;
              amt -= saved;
            }
            total += amt * promoMult();
          }

          if (after && after.checked) {
            let amt = AFTER_CARE_PRICE;
            if (!isFirst) {
              const saved = amt * SIBLING_DISCOUNT_RATE;
              discountSaved += saved;
              amt -= saved;
            }
            total += amt * promoMult();
          }
        }

        const lunch = document.querySelector(`input[name="lunch${i}"]:checked`);
        if (lunch && Number(lunch.value) === LUNCH_PRICE) {
          total += LUNCH_PRICE * promoMult();
        }
      }

      const totalEl = document.getElementById('total');
      if (totalEl) totalEl.textContent = total.toFixed(2);

      const line = document.getElementById('discountLine');
      const savedEl = document.getElementById('discountSaved');

      if (discountSaved > 0) {
        if (savedEl) savedEl.textContent = discountSaved.toFixed(2);
        if (line) line.classList.remove('hidden');
      } else {
        if (savedEl) savedEl.textContent = '0.00';
        if (line) line.classList.add('hidden');
      }

      if (ACTIVE_PROMO_PCT > 0) {
        const promoMsg = document.getElementById('promoMsg');
        if (promoMsg) promoMsg.textContent = `${ACTIVE_PROMO_PCT}% promo applied across all items.`;
      }

      checkoutButton.style.display = total > 0 && stripe ? 'inline-block' : 'none';
    }

    async function redirectToCheckout() {
      if (!stripe) {
        alert('Stripe not loaded. Please check your publishable key.');
        return;
      }

      const total = parseFloat(document.getElementById('total')?.textContent || '0');
      if (total <= 0) {
        alert('Please add at least one camper to proceed with payment.');
        return;
      }

      const parentFirstName = document.getElementById('parentFirstName')?.value.trim();
      const parentLastName = document.getElementById('parentLastName')?.value.trim();
      if (!parentFirstName || !parentLastName) {
        alert('Please fill in the parent name fields before proceeding to checkout.');
        return;
      }

      const lineItems = buildLineItems();
      const reg = gatherRegistrationData();
      const firstCamper = reg.campers[0] || {};
      const siblings = Math.max(0, reg.campers.length - 1);
      const discountSaved = Number((document.getElementById('discountSaved')?.textContent || '0').replace(/[^0-9.]/g, ''));
      const subtotal = (reg.total || 0) + discountSaved;

      const optionsSummary = reg.campers
        .map((c, i) => {
          const opts = [];
          if (c.beforeCare) opts.push(config.beforeCareLabel);
          if (c.afterCare) opts.push(config.afterCareLabel);
          if (c.hotLunch) opts.push(config.lunchLabel);
          return opts.length ? `Camper ${i + 1}: ${opts.join(', ')}` : '';
        })
        .filter(Boolean);

      const payload = {
        parentFirstName,
        parentLastName,
        parentEmail: '',
        parentPhone: '',
        camperFirstName: firstCamper.firstName || '',
        camperLastName: firstCamper.lastName || '',
        campName: config.campName,
        campDate: config.campDate,
        selections: optionsSummary,
        subtotal,
        siblingDiscount: discountSaved,
        siblings,
        total: reg.total || total,
        line_items: lineItems,
        success_url: successUrl,
        cancel_url: cancelUrl
        tab: 'Winter',
        camp: 'winter',
        registrationId
      };

      try {
        const res = await fetch(config.checkoutFunctionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(errText || 'Checkout session failed');
        }

        const { url } = await res.json();
        window.location.href = url;
      } catch (err) {
        console.error('Checkout error:', err);
        alert('Checkout error: ' + (err.message || err));
      }
    }

    numSel.addEventListener('change', () => {
      CAMPER_STATE = captureState();
      renderCamperForms();
      applyState(CAMPER_STATE);
      updateTotal();
    });

    document.getElementById('applyPromoBtn')?.addEventListener('click', applyPromo);
    document.getElementById('promoCode')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyPromo();
    });

    checkoutButton.addEventListener('click', redirectToCheckout);

    loadCapacity();
    renderCamperForms();
    applyState(CAMPER_STATE);
    updateTotal();
    updateFullness();
  }
})();
