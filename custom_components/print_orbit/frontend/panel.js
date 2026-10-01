class PrintOrbitPanel extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._initialised = false;
    this._state = { printers: [], files: [], jobId: null, poll: null };
  }

  set hass(value) {
    this._hass = value;
    if (!this._initialised) {
      this._initialised = true;
      this._render();
      this._bind();
      this._refreshAll();
    }
  }

  set narrow(_value) {}
  set panel(_value) {}

  disconnectedCallback() {
    if (this._state.poll) clearTimeout(this._state.poll);
  }

  _render() {
    this.innerHTML = `
      <style>
        print-orbit-panel {
          display:block;
          min-height:100%;
          background:var(--primary-background-color);
          color:var(--primary-text-color);
          --cfs-space-1:var(--ha-space-1, 4px);
          --cfs-space-2:var(--ha-space-2, 8px);
          --cfs-space-3:var(--ha-space-3, 12px);
          --cfs-space-4:var(--ha-space-4, 16px);
          --cfs-space-6:var(--ha-space-6, 24px);
        }
        * { box-sizing:border-box; }
        .cfs-wrap { max-width:1200px; margin:0 auto; padding:var(--cfs-space-6); }
        .cfs-top { display:flex; align-items:center; justify-content:space-between; gap:var(--cfs-space-4); margin-bottom:var(--cfs-space-6); }
        .cfs-heading { display:flex; align-items:center; gap:var(--cfs-space-3); min-width:0; }
        .cfs-heading-icon { display:grid; place-items:center; width:48px; height:48px; flex:0 0 48px; border-radius:var(--ha-border-radius-lg, 12px); background:var(--ha-color-fill-primary-quiet-resting, var(--secondary-background-color)); color:var(--primary-color); }
        .cfs-heading-icon ha-icon { --mdc-icon-size:28px; }
        .cfs-title { font-size:var(--ha-font-size-2xl, 24px); line-height:1.2; margin:0 0 var(--cfs-space-1); font-weight:var(--ha-font-weight-medium, 500); letter-spacing:-.01em; }
        .cfs-sub, .cfs-muted { color:var(--secondary-text-color); }
        .cfs-sub { line-height:1.45; }
        .cfs-badge { font-size:var(--ha-font-size-xs, 12px); padding:var(--cfs-space-1) var(--cfs-space-3); border:1px solid var(--divider-color); border-radius:var(--ha-border-radius-pill, 999px); color:var(--secondary-text-color); white-space:nowrap; }
        .cfs-grid { display:grid; grid-template-columns:minmax(0, 1.1fr) minmax(360px, .9fr); gap:var(--cfs-space-4); align-items:start; }
        ha-card.cfs-card { min-width:0; overflow:hidden; }
        .cfs-wide { grid-column:1/-1; }
        .card-content { padding:var(--cfs-space-4); }
        .cfs-card-head { display:flex; justify-content:space-between; align-items:flex-start; gap:var(--cfs-space-3); margin-bottom:var(--cfs-space-4); }
        .cfs-card-title { display:flex; align-items:flex-start; gap:var(--cfs-space-3); min-width:0; }
        .cfs-step { display:grid; place-items:center; width:28px; height:28px; flex:0 0 28px; border-radius:50%; background:var(--primary-color); color:var(--text-primary-color, white); font-size:var(--ha-font-size-s, 13px); font-weight:var(--ha-font-weight-bold, 700); }
        .cfs-card-title h2 { font-size:var(--ha-font-size-l, 18px); line-height:1.25; margin:2px 0 var(--cfs-space-1); font-weight:var(--ha-font-weight-medium, 500); }
        .cfs-card-description { color:var(--secondary-text-color); font-size:var(--ha-font-size-s, 13px); line-height:1.4; }
        .cfs-count { flex:none; padding-top:4px; color:var(--secondary-text-color); font-size:var(--ha-font-size-s, 13px); }
        .cfs-form-grid { display:grid; grid-template-columns:minmax(0, 1.2fr) minmax(0, 1fr) 120px auto; gap:var(--cfs-space-2); align-items:start; }
        .cfs-field { min-width:0; }
        .cfs-field label { display:block; font-size:var(--ha-font-size-xs, 12px); color:var(--secondary-text-color); margin:0 0 var(--cfs-space-1) var(--cfs-space-1); }
        .cfs-field input, .cfs-field select {
          width:100%; height:48px; padding:0 var(--cfs-space-3); border:0; border-bottom:1px solid var(--ha-color-border-neutral-loud, var(--divider-color)); border-radius:var(--ha-border-radius-md, 8px) var(--ha-border-radius-md, 8px) 0 0;
          background:var(--ha-color-form-background-resting, var(--input-fill-color, var(--secondary-background-color))); color:var(--primary-text-color); font:inherit; outline:none;
        }
        .cfs-field select { cursor:pointer; }
        .cfs-field input:hover, .cfs-field select:hover { background:var(--ha-color-form-background-hover, var(--secondary-background-color)); }
        .cfs-field input:focus, .cfs-field select:focus { border-bottom:2px solid var(--primary-color); }
        .cfs-field input.cfs-input-error { border-bottom-color:var(--error-color); background:var(--ha-color-fill-danger-quiet-resting, var(--input-fill-color, var(--secondary-background-color))); }
        .cfs-add { align-self:end; margin-bottom:0; }
        .cfs-native-submit { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
        .cfs-list { display:flex; flex-direction:column; margin-top:var(--cfs-space-4); border-top:1px solid var(--divider-color); }
        .cfs-item { display:grid; grid-template-columns:auto auto minmax(0, 1fr) auto; gap:var(--cfs-space-3); align-items:center; min-width:0; min-height:64px; padding:var(--cfs-space-2) 0; border-bottom:1px solid var(--divider-color); }
        .cfs-item:last-child { border-bottom:0; }
        .cfs-item input[type=checkbox] { width:20px; height:20px; margin:0 var(--cfs-space-1); accent-color:var(--primary-color); cursor:pointer; }
        .cfs-item-icon { display:grid; place-items:center; width:36px; height:36px; border-radius:50%; background:var(--ha-color-fill-neutral-quiet-resting, var(--secondary-background-color)); color:var(--secondary-text-color); }
        .cfs-item-icon ha-icon { --mdc-icon-size:20px; }
        .cfs-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
        .cfs-meta { color:var(--secondary-text-color); font-size:var(--ha-font-size-xs, 12px); line-height:1.4; overflow:hidden; text-overflow:ellipsis; }
        .cfs-drop { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:180px; border:2px dashed var(--ha-color-border-neutral-normal, var(--divider-color)); border-radius:var(--ha-border-radius-lg, 12px); padding:var(--cfs-space-6); text-align:center; transition:background-color .15s ease, border-color .15s ease; }
        .cfs-drop-icon { display:grid; place-items:center; width:52px; height:52px; margin-bottom:var(--cfs-space-3); border-radius:50%; background:var(--ha-color-fill-primary-quiet-resting, var(--secondary-background-color)); color:var(--primary-color); }
        .cfs-drop-icon ha-icon { --mdc-icon-size:28px; }
        .cfs-drop-title { font-weight:var(--ha-font-weight-medium, 500); margin-bottom:var(--cfs-space-1); }
        .cfs-drop.drag { border-color:var(--primary-color); background:var(--ha-color-fill-primary-quiet-resting, var(--secondary-background-color)); }
        .cfs-picker { display:none; }
        .cfs-actions { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:var(--cfs-space-2); margin-top:var(--cfs-space-3); }
        .cfs-file-actions { display:flex; gap:var(--cfs-space-2); flex-wrap:wrap; }
        .cfs-notice:empty { display:none; }
        .cfs-notice { display:block; margin-top:var(--cfs-space-3); }
        .cfs-empty { display:flex; flex-direction:column; align-items:center; gap:var(--cfs-space-2); color:var(--secondary-text-color); font-size:var(--ha-font-size-s, 13px); padding:var(--cfs-space-6) var(--cfs-space-3); text-align:center; }
        .cfs-empty ha-icon { --mdc-icon-size:28px; opacity:.7; }
        .cfs-copy-layout { display:grid; grid-template-columns:minmax(0, 1fr) auto; gap:var(--cfs-space-4); align-items:center; }
        .cfs-selection { display:flex; flex-wrap:wrap; gap:var(--cfs-space-2); margin-top:var(--cfs-space-3); }
        .cfs-selection-chip { display:inline-flex; align-items:center; gap:var(--cfs-space-1); padding:5px 10px; border-radius:var(--ha-border-radius-pill, 999px); background:var(--ha-color-fill-neutral-quiet-resting, var(--secondary-background-color)); color:var(--secondary-text-color); font-size:var(--ha-font-size-xs, 12px); }
        .cfs-selection-chip ha-icon { --mdc-icon-size:16px; }
        .cfs-job-list:not(:empty) { margin-top:var(--cfs-space-4); border-top:1px solid var(--divider-color); }
        .cfs-job { display:grid; grid-template-columns:1.1fr 1.1fr 2fr auto; gap:var(--cfs-space-3); align-items:center; padding:var(--cfs-space-3) 0; border-bottom:1px solid var(--divider-color); }
        .cfs-job:last-child { border-bottom:0; }
        .cfs-progress { height:6px; background:var(--secondary-background-color); border-radius:var(--ha-border-radius-pill, 999px); overflow:hidden; }
        .cfs-bar { height:100%; width:0; background:var(--primary-color); transition:width .2s ease; }
        .cfs-ok { color:var(--success-color, var(--primary-color)); } .cfs-bad { color:var(--error-color); } .cfs-wait { color:var(--warning-color, var(--secondary-text-color)); }
        @media (max-width:900px) {
          .cfs-grid { grid-template-columns:1fr; }
          .cfs-wide { grid-column:auto; }
          .cfs-form-grid { grid-template-columns:1fr 1fr; }
          .cfs-access-code { grid-column:1/-1; }
          .cfs-add { align-self:end; }
        }
        @media (max-width:600px) {
          .cfs-wrap { padding:var(--cfs-space-3); }
          .cfs-top { align-items:flex-start; }
          .cfs-heading-icon { width:40px; height:40px; flex-basis:40px; }
          .cfs-badge { display:none; }
          .cfs-form-grid { grid-template-columns:1fr; }
          .cfs-access-code { grid-column:auto; }
          .cfs-add { justify-self:stretch; }
          .cfs-add, .cfs-add ha-button { width:100%; }
          .cfs-copy-layout { grid-template-columns:1fr; }
          .cfs-copy-layout ha-button { width:100%; }
          .cfs-job { grid-template-columns:1fr 1fr; }
          .cfs-progcell { grid-column:1/-1; }
        }
      </style>
      <div class="cfs-wrap">
        <div class="cfs-top">
          <div class="cfs-heading">
            <div class="cfs-heading-icon"><ha-icon icon="mdi:orbit"></ha-icon></div>
            <div><h1 class="cfs-title">Print Orbit</h1><div class="cfs-sub">Manage and distribute G-code across your connected printers.</div></div>
          </div>
          <span class="cfs-badge">v0.4.0 · Centauri adapter</span>
        </div>

        <div class="cfs-grid">
          <ha-card class="cfs-card">
            <div class="card-content">
              <div class="cfs-card-head">
                <div class="cfs-card-title"><span class="cfs-step">1</span><div><h2>Printers</h2><div class="cfs-card-description">Add and select the printers that should receive files.</div></div></div>
                <span id="cfsPrinterCount" class="cfs-count"></span>
              </div>
              <form id="cfsPrinterForm" class="cfs-form-grid">
                <div class="cfs-field"><label for="cfsPrinterName">Printer name</label><input id="cfsPrinterName" required autocomplete="off" placeholder="Left printer"></div>
                <div class="cfs-field"><label for="cfsPrinterHost">IPv4 address</label><input id="cfsPrinterHost" required inputmode="decimal" maxlength="15" autocomplete="off" spellcheck="false" placeholder="192.168.1.51"></div>
                <div class="cfs-field"><label for="cfsPrinterModel">Model</label><select id="cfsPrinterModel"><option value="cc1">CC1</option><option value="cc2">CC2</option></select></div>
                <div class="cfs-add"><ha-button id="cfsAddPrinter" appearance="filled" type="button">Add printer</ha-button></div>
                <div id="cfsAccessCodeWrap" class="cfs-field cfs-access-code" style="display:none"><label for="cfsAccessCode">CC2 access code</label><input id="cfsAccessCode" type="password" autocomplete="off"></div>
                <button class="cfs-native-submit" type="submit" tabindex="-1" aria-hidden="true"></button>
              </form>
              <div id="cfsPrinterNotice" class="cfs-notice"></div>
              <div id="cfsPrinterList" class="cfs-list"></div>
            </div>
          </ha-card>

          <ha-card class="cfs-card">
            <div class="card-content">
              <div class="cfs-card-head">
                <div class="cfs-card-title"><span class="cfs-step">2</span><div><h2>G-code files</h2><div class="cfs-card-description">Stage one or more sliced files in Home Assistant.</div></div></div>
                <span id="cfsFileCount" class="cfs-count"></span>
              </div>
              <div id="cfsDrop" class="cfs-drop">
                <div class="cfs-drop-icon"><ha-icon icon="mdi:file-upload-outline"></ha-icon></div>
                <div class="cfs-drop-title">Drop .gcode files here</div>
                <div class="cfs-muted">or select files from this device</div>
                <ha-button id="cfsChooseFiles" appearance="outlined" size="s" type="button" style="margin-top:12px">Choose files</ha-button>
                <input id="cfsFilePicker" class="cfs-picker" type="file" multiple accept=".gcode">
              </div>
              <div id="cfsFileNotice" class="cfs-notice"></div>
              <div id="cfsFileList" class="cfs-list"></div>
              <div class="cfs-actions"><span class="cfs-muted">Files stay staged until removed.</span><div class="cfs-file-actions"><ha-button id="cfsRemoveRemote" appearance="plain" variant="danger" size="s" type="button">Delete from printers</ha-button><ha-button id="cfsRemoveStaged" appearance="plain" variant="danger" size="s" type="button">Remove selected</ha-button></div></div>
            </div>
          </ha-card>

          <ha-card class="cfs-card cfs-wide">
            <div class="card-content">
              <div class="cfs-copy-layout">
                <div>
                  <div class="cfs-card-title"><span class="cfs-step">3</span><div><h2>Send files</h2><div class="cfs-card-description">Printers upload in parallel; each printer receives one file at a time.</div></div></div>
                  <div class="cfs-selection">
                    <span class="cfs-selection-chip"><ha-icon icon="mdi:file-check-outline"></ha-icon><span id="cfsSelectedFileCount">0 files selected</span></span>
                    <span class="cfs-selection-chip"><ha-icon icon="mdi:printer-3d"></ha-icon><span id="cfsSelectedPrinterCount">0 printers selected</span></span>
                  </div>
                </div>
                <ha-button id="cfsCopyButton" appearance="filled" size="l" type="button">Send selected files</ha-button>
              </div>
              <div id="cfsCopyNotice" class="cfs-notice"></div>
              <div id="cfsJobList" class="cfs-job-list"></div>
            </div>
          </ha-card>
        </div>
      </div>`;
  }

  _$(id) { return this.querySelector(`#${id}`); }
  _esc(value) { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  _human(n) { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`; }
  _selected(selector) { return [...this.querySelectorAll(selector)].filter(x => x.checked).map(x => x.value); }
  _note(id, message, type='info') {
    const host = this._$(id);
    host.replaceChildren();
    if (!message) return;
    const alert = document.createElement('ha-alert');
    alert.setAttribute('alert-type', type === true ? 'error' : type);
    alert.textContent = message;
    host.appendChild(alert);
  }

  _setButtonBusy(id, busy) {
    const button = this._$(id);
    button.disabled = busy;
    button.loading = busy;
  }

  _updateSelectionSummary() {
    const files = this._selected('.cfsFileCheck').length;
    const printers = this._selected('.cfsPrinterCheck').length;
    this._$('cfsSelectedFileCount').textContent = `${files} file${files === 1 ? '' : 's'} selected`;
    this._$('cfsSelectedPrinterCount').textContent = `${printers} printer${printers === 1 ? '' : 's'} selected`;
    this._$('cfsRemoveStaged').disabled = files === 0;
    this._$('cfsRemoveRemote').disabled = files === 0 || printers === 0;
    if (!this._state.jobId) this._$('cfsCopyButton').disabled = files === 0 || printers === 0;
  }

  _errorMessage(error, fallback='Request failed.') {
    if (!error) return fallback;
    if (typeof error === 'string') return error;
    const candidates = [
      error.detail,
      error.message,
      error.body && error.body.detail,
      error.body && error.body.message,
      error.error && error.error.detail,
      error.error && error.error.message,
    ];
    const message = candidates.find(value => typeof value === 'string' && value.trim() && value !== '[object Object]');
    return message ? message.trim() : fallback;
  }

  _isIPv4(value) {
    const parts = value.split('.');
    return parts.length === 4 && parts.every(part => {
      if (!/^(0|[1-9]\d{0,2})$/.test(part)) return false;
      return Number(part) <= 255;
    });
  }

  async _api(method, path, body) {
    try {
      return await this._hass.callApi(method, `print_orbit/${path}`, body);
    } catch (error) {
      throw new Error(this._errorMessage(error));
    }
  }

  async _stageChunk(file, uploadId, offset, chunk) {
    const query = new URLSearchParams({
      upload_id: uploadId,
      filename: file.name,
      offset: String(offset),
      total: String(file.size),
    });
    const response = await this._hass.fetchWithAuth(`/api/print_orbit/files/chunk?${query.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: chunk,
    });
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try { const payload = await response.json(); message = payload.detail || message; } catch (_err) {}
      throw new Error(message);
    }
    return response.json();
  }

  _bind() {
    const printerForm = this._$('cfsPrinterForm');
    const printerHost = this._$('cfsPrinterHost');
    const accessCode = this._$('cfsAccessCode');
    const updateModelFields = () => {
      const isCc2 = this._$('cfsPrinterModel').value === 'cc2';
      this._$('cfsAccessCodeWrap').style.display = isCc2 ? 'block' : 'none';
      accessCode.required = isCc2;
      if (!isCc2) accessCode.setCustomValidity('');
    };

    this._$('cfsPrinterModel').addEventListener('change', updateModelFields);
    this._$('cfsAddPrinter').addEventListener('click', () => printerForm.requestSubmit());
    printerHost.addEventListener('input', () => {
      printerHost.setCustomValidity('');
      printerHost.classList.remove('cfs-input-error');
    });
    accessCode.addEventListener('input', () => accessCode.setCustomValidity(''));

    printerForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const host = printerHost.value.trim();
      if (!this._isIPv4(host)) {
        const message = 'Enter a valid IPv4 address, for example 192.168.1.51.';
        printerHost.setCustomValidity(message);
        printerHost.classList.add('cfs-input-error');
        printerHost.reportValidity();
        this._note('cfsPrinterNotice', message, 'error');
        return;
      }
      if (this._$('cfsPrinterModel').value === 'cc2' && !accessCode.value.trim()) {
        const message = 'Enter the access code for this CC2 printer.';
        accessCode.setCustomValidity(message);
        accessCode.reportValidity();
        this._note('cfsPrinterNotice', message, 'error');
        return;
      }
      if (!printerForm.reportValidity()) return;

      this._note('cfsPrinterNotice', 'Saving…');
      this._setButtonBusy('cfsAddPrinter', true);
      const body = {
        name: this._$('cfsPrinterName').value.trim(),
        host,
        model: this._$('cfsPrinterModel').value,
        access_code: accessCode.value.trim() || null,
      };
      try {
        await this._api('POST', 'printers', body);
        printerForm.reset();
        updateModelFields();
        this._note('cfsPrinterNotice', 'Printer added.', 'success');
        await this._refreshPrinters();
      } catch (err) {
        this._note('cfsPrinterNotice', this._errorMessage(err), 'error');
      } finally {
        this._setButtonBusy('cfsAddPrinter', false);
      }
    });

    this._$('cfsPrinterList').addEventListener('click', async (event) => {
      const removeButton = event.target.closest('[data-remove-printer]');
      const id = removeButton && removeButton.dataset.removePrinter;
      if (!id) return;
      try {
        await this._api('DELETE', `printers/${encodeURIComponent(id)}`);
        this._note('cfsPrinterNotice', 'Printer removed.', 'success');
        await this._refreshPrinters();
      } catch (err) { this._note('cfsPrinterNotice', this._errorMessage(err), 'error'); }
    });
    this._$('cfsPrinterList').addEventListener('change', () => this._updateSelectionSummary());

    this._$('cfsChooseFiles').addEventListener('click', () => this._$('cfsFilePicker').click());
    this._$('cfsFilePicker').addEventListener('change', (event) => this._stage(event.target.files));
    const drop = this._$('cfsDrop');
    ['dragenter','dragover'].forEach(name => drop.addEventListener(name, event => { event.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave','drop'].forEach(name => drop.addEventListener(name, event => { event.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', event => this._stage(event.dataTransfer.files));
    this._$('cfsFileList').addEventListener('change', () => this._updateSelectionSummary());

    this._$('cfsRemoveStaged').addEventListener('click', async () => {
      const files = this._selected('.cfsFileCheck');
      if (!files.length) { this._note('cfsFileNotice', 'Select at least one staged file.', 'error'); return; }
      try {
        await this._api('POST', 'files/delete', { files });
        this._note('cfsFileNotice', `Removed ${files.length} staged file${files.length===1?'':'s'}.`, 'success');
        await this._refreshFiles();
      } catch (err) { this._note('cfsFileNotice', this._errorMessage(err), 'error'); }
    });

    this._$('cfsRemoveRemote').addEventListener('click', async () => {
      const files = this._selected('.cfsFileCheck');
      const printers = this._selected('.cfsPrinterCheck');
      if (!files.length || !printers.length) {
        this._note('cfsFileNotice', 'Select at least one file and one printer.', 'error');
        return;
      }
      const confirmed = window.confirm(
        `Delete ${files.length} selected file${files.length === 1 ? '' : 's'} from ${printers.length} printer${printers.length === 1 ? '' : 's'}? This cannot be undone.`,
      );
      if (!confirmed) return;
      this._setButtonBusy('cfsRemoveRemote', true);
      this._note('cfsFileNotice', 'Deleting selected files from printers…');
      try {
        const result = await this._api('POST', 'files/remote-delete', { files, printers });
        const failed = result.results.filter(item => item.error);
        const deleted = result.deleted;
        const message = failed.length
          ? `Deleted ${deleted} remote file${deleted === 1 ? '' : 's'}; ${failed.length} printer${failed.length === 1 ? ' reported an error' : 's reported errors'}. ${failed.map(item => `${item.printer_name}: ${item.error}`).join(' ')}`
          : `Deleted ${deleted} remote file${deleted === 1 ? '' : 's'}.`;
        this._note('cfsFileNotice', message, failed.length ? 'warning' : 'success');
      } catch (err) {
        this._note('cfsFileNotice', this._errorMessage(err), 'error');
      } finally {
        this._setButtonBusy('cfsRemoveRemote', false);
      }
    });

    this._$('cfsCopyButton').addEventListener('click', async () => {
      const files = this._selected('.cfsFileCheck');
      const printers = this._selected('.cfsPrinterCheck');
      if (!files.length || !printers.length) { this._note('cfsCopyNotice', 'Select at least one file and one printer.', 'error'); return; }
      this._setButtonBusy('cfsCopyButton', true);
      this._note('cfsCopyNotice', `Starting ${files.length * printers.length} upload${files.length * printers.length === 1 ? '' : 's'}…`);
      try {
        const result = await this._api('POST', 'copy', { files, printers });
        this._state.jobId = result.job_id;
        await this._pollJob();
      } catch (err) {
        this._state.jobId = null;
        this._setButtonBusy('cfsCopyButton', false);
        this._note('cfsCopyNotice', this._errorMessage(err), 'error');
        this._updateSelectionSummary();
      }
    });
  }

  async _refreshAll() {
    try { await Promise.all([this._refreshPrinters(), this._refreshFiles()]); }
    catch (err) { this._note('cfsCopyNotice', this._errorMessage(err), 'error'); }
  }

  async _refreshPrinters() {
    this._state.printers = await this._api('GET', 'printers');
    this._$('cfsPrinterCount').textContent = `${this._state.printers.length} configured`;
    this._$('cfsPrinterList').innerHTML = this._state.printers.length ? this._state.printers.map(p => `
      <div class="cfs-item">
        <input class="cfsPrinterCheck" type="checkbox" value="${this._esc(p.id)}" checked aria-label="Select ${this._esc(p.name)}">
        <span class="cfs-item-icon"><ha-icon icon="mdi:printer-3d"></ha-icon></span>
        <div class="cfs-name"><strong>${this._esc(p.name)}</strong><div class="cfs-meta">${this._esc(p.host)} · ${String(p.model).toUpperCase()}${p.has_access_code?' · access code saved':''}</div></div>
        <ha-button appearance="plain" variant="danger" size="s" type="button" data-remove-printer="${this._esc(p.id)}">Remove</ha-button>
      </div>`).join('') : '<div class="cfs-empty"><ha-icon icon="mdi:printer-off-outline"></ha-icon><span>No printers configured yet.</span></div>';
    this._updateSelectionSummary();
  }

  async _refreshFiles() {
    this._state.files = await this._api('GET', 'files');
    this._$('cfsFileCount').textContent = `${this._state.files.length} staged`;
    this._$('cfsFileList').innerHTML = this._state.files.length ? this._state.files.map(f => `
      <div class="cfs-item">
        <input class="cfsFileCheck" type="checkbox" value="${this._esc(f.name)}" checked aria-label="Select ${this._esc(f.name)}">
        <span class="cfs-item-icon"><ha-icon icon="mdi:file-code-outline"></ha-icon></span>
        <div class="cfs-name"><strong>${this._esc(f.name)}</strong><div class="cfs-meta">${this._human(f.size)}</div></div>
        <span class="cfs-meta">Ready</span>
      </div>`).join('') : '<div class="cfs-empty"><ha-icon icon="mdi:file-outline"></ha-icon><span>No files staged yet.</span></div>';
    this._updateSelectionSummary();
  }

  async _stage(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const invalid = files.find(file => !file.name.toLowerCase().endsWith('.gcode'));
    if (invalid) { this._note('cfsFileNotice', `${invalid.name}: only .gcode files are accepted.`, 'error'); return; }

    const chunkSize = 4 * 1024 * 1024;
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        if (!file.size) throw new Error(`${file.name} is empty.`);
        const uploadId = (globalThis.crypto && crypto.randomUUID)
          ? crypto.randomUUID().replace(/-/g, '')
          : `u${Date.now()}${Math.random().toString(36).slice(2)}`;
        let offset = 0;
        while (offset < file.size) {
          const end = Math.min(offset + chunkSize, file.size);
          const chunk = file.slice(offset, end);
          await this._stageChunk(file, uploadId, offset, chunk);
          offset = end;
          const pct = Math.round((offset / file.size) * 100);
          this._note('cfsFileNotice', `Staging ${index + 1}/${files.length}: ${file.name} · ${pct}%`);
        }
      }
      this._note('cfsFileNotice', `Staged ${files.length} file${files.length===1?'':'s'}.`, 'success');
      await this._refreshFiles();
    } catch (err) {
      this._note('cfsFileNotice', this._errorMessage(err), 'error');
    }
    this._$('cfsFilePicker').value = '';
  }

  async _pollJob() {
    if (!this._state.jobId) return;
    try {
      const job = await this._api('GET', `jobs/${this._state.jobId}`);
      this._renderJob(job);
      if (job.status === 'running') {
        this._state.poll = setTimeout(() => this._pollJob(), 700);
      } else {
        this._state.jobId = null;
        this._setButtonBusy('cfsCopyButton', false);
        this._note(
          'cfsCopyNotice',
          job.status === 'complete'
            ? 'Uploads completed. Existing printer files were not checked; a printer may rename duplicates.'
            : 'Finished with one or more failures.',
          job.status === 'complete' ? 'warning' : 'error',
        );
        this._updateSelectionSummary();
      }
    } catch (err) {
      this._state.jobId = null;
      this._setButtonBusy('cfsCopyButton', false);
      this._note('cfsCopyNotice', this._errorMessage(err), 'error');
      this._updateSelectionSummary();
    }
  }

  _renderJob(job) {
    this._$('cfsJobList').innerHTML = job.items.map(item => {
      const pct = item.total ? Math.round((item.sent / item.total) * 100) : 0;
      const status = item.status === 'complete' ? '<span class="cfs-ok">✓ uploaded</span>' :
        item.status === 'failed' ? `<span class="cfs-bad" title="${this._esc(item.error || '')}">✕ failed</span>` :
        item.status === 'uploading' ? `<span class="cfs-wait">${pct}%</span>` : '<span class="cfs-muted">queued</span>';
      return `<div class="cfs-job">
        <div class="cfs-name">${this._esc(item.file)}</div>
        <div>${this._esc(item.printer_name)}</div>
        <div class="cfs-progcell"><div class="cfs-progress"><div class="cfs-bar" style="width:${pct}%"></div></div><div class="cfs-meta">${this._human(item.sent)} / ${this._human(item.total)}${item.error ? ' · ' + this._esc(item.error) : ''}</div>${item.warning ? `<div class="cfs-wait">${this._esc(item.warning)}</div>` : ''}</div>
        <div>${status}</div>
      </div>`;
    }).join('');
  }
}

if (!customElements.get('print-orbit-panel')) {
  customElements.define('print-orbit-panel', PrintOrbitPanel);
}
