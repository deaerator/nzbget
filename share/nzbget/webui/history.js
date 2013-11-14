/*
 * This file is part of nzbget
 *
 * Copyright (C) 2012-2013 Andrey Prygunkov <hugbug@users.sourceforge.net>
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 *
 * $Revision: 905 $
 * $Date: 2013-11-08 22:54:44 +0100 (Fri, 08 Nov 2013) $
 *
 */

/*
 * In this module:
 *   1) History tab;
 *   2) Functions for html generation for history, also used from other modules (edit dialog).
 */

/*** HISTORY TAB AND EDIT HISTORY DIALOG **********************************************/

var History = (new function($)
{
	'use strict';

	// Controls
	var $HistoryTable;
	var $HistoryTabBadge;
	var $HistoryTabBadgeEmpty;
	var $HistoryRecordsPerPage;

	// State
	var history;
	var notification = null;
	var updateTabInfo;
	var curFilter = 'ALL';
	var activeTab = false;
	var showDup = false;

	this.init = function(options)
	{
		updateTabInfo = options.updateTabInfo;

		$HistoryTable = $('#HistoryTable');
		$HistoryTabBadge = $('#HistoryTabBadge');
		$HistoryTabBadgeEmpty = $('#HistoryTabBadgeEmpty');
		$HistoryRecordsPerPage = $('#HistoryRecordsPerPage');

		var recordsPerPage = UISettings.read('HistoryRecordsPerPage', 10);
		$HistoryRecordsPerPage.val(recordsPerPage);

		$HistoryTable.fasttable(
			{
				filterInput: $('#HistoryTable_filter'),
				filterClearButton: $("#HistoryTable_clearfilter"),
				pagerContainer: $('#HistoryTable_pager'),
				infoContainer: $('#HistoryTable_info'),
				headerCheck: $('#HistoryTable > thead > tr:first-child'),
				filterCaseSensitive: false,
				pageSize: recordsPerPage,
				maxPages: UISettings.miniTheme ? 1 : 5,
				pageDots: !UISettings.miniTheme,
				fillFieldsCallback: fillFieldsCallback,
				filterCallback: filterCallback,
				renderCellCallback: renderCellCallback,
				updateInfoCallback: updateInfo
			});

		$HistoryTable.on('click', 'a', editClick);
		$HistoryTable.on('click', 'tbody div.check',
			function(event) { $HistoryTable.fasttable('itemCheckClick', this.parentNode.parentNode, event); });
		$HistoryTable.on('click', 'thead div.check',
			function() { $HistoryTable.fasttable('titleCheckClick') });
		$HistoryTable.on('mousedown', Util.disableShiftMouseDown);
	}

	this.applyTheme = function()
	{
		$HistoryTable.fasttable('setPageSize', UISettings.read('HistoryRecordsPerPage', 10),
			UISettings.miniTheme ? 1 : 5, !UISettings.miniTheme);
	}

	this.show = function()
	{
		activeTab = true;
		this.redraw();
	}

	this.hide = function()
	{
		activeTab = false;
	}

	this.update = function()
	{
		if (!history)
		{
			$('#HistoryTable_Category').css('width', DownloadsUI.calcCategoryColumnWidth());
			initFilterButtons();
		}

		RPC.call('history', [showDup], loaded);
	}

	function loaded(curHistory)
	{
		history = curHistory;
		prepare();
		RPC.next();
	}

	function prepare()
	{
		for (var j=0, jl=history.length; j < jl; j++)
		{
			detectStatus(history[j]);
		}
	}

	function detectStatus(hist)
	{
		if (hist.Kind === 'NZB')
		{
			if (hist.MarkStatus === 'BAD')
			{
				hist.status = 'failure'; hist.FilterKind = 'FAILURE';
			}
			else if (hist.DeleteStatus !== 'NONE')
			{
				switch (hist.DeleteStatus)
				{
					case 'HEALTH': hist.status = 'deleted-health'; hist.FilterKind = 'FAILURE'; break;
					case 'MANUAL': hist.status = 'deleted-manual'; hist.FilterKind = 'DELETED'; break;
					case 'DUPE': hist.status = 'deleted-dupe'; hist.FilterKind = 'DUPE'; break;
				}
			}
			else if (hist.ParStatus == 'FAILURE' || hist.UnpackStatus == 'FAILURE' || hist.MoveStatus == 'FAILURE')
			{
				hist.status = 'failure'; hist.FilterKind = 'FAILURE';
			}
			else if (hist.ParStatus == 'MANUAL')
			{
				hist.status = 'damaged'; hist.FilterKind = 'FAILURE';
			}
			else if (hist.ParStatus == 'REPAIR_POSSIBLE')
			{
				hist.status = 'repairable'; hist.FilterKind = 'FAILURE';
			}
			else if (hist.ParStatus == 'NONE' && hist.UnpackStatus == 'NONE' &&
				(hist.ScriptStatus !== 'FAILURE' || hist.Health < 1000))
			{
				hist.status = hist.Health === 1000 ? 'success' :
					hist.Health >= hist.CriticalHealth ? 'damaged' : 'failure';
				hist.FilterKind = hist.status === 'success' ? 'SUCCESS' : 'FAILURE';
			}
			else
			{
				switch (hist.UnpackStatus)
				{
					case 'SPACE': hist.status = 'space'; hist.FilterKind = 'FAILURE'; break;
					case 'PASSWORD': hist.status = 'password'; hist.FilterKind = 'FAILURE'; break;
					case 'SUCCESS':
					case 'NONE':
						switch (hist.ScriptStatus)
						{
							case 'SUCCESS': hist.status = 'success'; hist.FilterKind = 'SUCCESS'; break;
							case 'FAILURE': hist.status = 'pp-failure'; hist.FilterKind = 'FAILURE'; break;
							case 'UNKNOWN': hist.status = 'unknown'; hist.FilterKind = 'FAILURE'; break;
							case 'NONE': hist.status = 'success'; hist.FilterKind = 'SUCCESS'; break;
						}
				}
			}
		}
		else if (hist.Kind === 'URL')
		{
			switch (hist.UrlStatus)
			{
				case 'SUCCESS': hist.status = 'success'; hist.FilterKind = 'SUCCESS'; break;
				case 'FAILURE': hist.status = 'failure'; hist.FilterKind = 'FAILURE'; break;
				case 'UNKNOWN': hist.status = 'unknown'; hist.FilterKind = 'FAILURE'; break;
				case 'SCAN_FAILURE': hist.status = 'failure'; hist.FilterKind = 'FAILURE'; break;
				case 'SCAN_SKIPPED': hist.status = 'skipped'; hist.FilterKind = 'FAILURE'; break;
			}
		}
		else if (hist.Kind === 'DUP')
		{
			switch (hist.DupStatus)
			{
				case 'SUCCESS': hist.status = 'success'; hist.FilterKind = 'SUCCESS'; break;
				case 'FAILURE': hist.status = 'failure'; hist.FilterKind = 'FAILURE'; break;
				case 'DELETED': hist.status = 'deleted-manual'; hist.FilterKind = 'DELETED'; break;
				case 'DUPE': hist.status = 'deleted-dupe'; hist.FilterKind = 'DUPE'; break;
				case 'GOOD': hist.status = 'GOOD'; hist.FilterKind = 'SUCCESS'; break;
				case 'BAD': hist.status = 'failure'; hist.FilterKind = 'FAILURE'; break;
				case 'UNKNOWN': hist.status = 'unknown'; hist.FilterKind = 'FAILURE'; break;
			}
		}
	}

	this.redraw = function()
	{
		var data = [];

		for (var i=0; i < history.length; i++)
		{
			var hist = history[i];

			var kind = hist.Kind;
			var statustext = hist.status === 'none' ? 'unknown' : hist.status;
			var size = kind === 'URL' ? '' : Util.formatSizeMB(hist.FileSizeMB);
			var time = Util.formatDateTime(hist.HistoryTime + UISettings.timeZoneCorrection*60*60);
			var dupe = DownloadsUI.buildDupeText(hist.DupeKey, hist.DupeScore, hist.DupeMode);
			var category = '';

			var textname = hist.Name;
			if (kind === 'URL')
			{
				textname += ' URL';
			}
			else if (kind === 'DUP')
			{
				textname += ' hidden';
			}

			if (kind !== 'DUP')
			{
				category = hist.Category;
			}

			var item =
			{
				id: hist.ID,
				hist: hist,
				data: {time: time, size: size},
				search: statustext + ' ' + time + ' ' + textname + ' ' + dupe + ' ' + category + ' ' + size
			};

			data.push(item);
		}

		$HistoryTable.fasttable('update', data);

		Util.show($HistoryTabBadge, history.length > 0);
		Util.show($HistoryTabBadgeEmpty, history.length === 0 && UISettings.miniTheme);
	}

	function fillFieldsCallback(item)
	{
		var hist = item.hist;

		var status = HistoryUI.buildStatus(hist.status, '');

		var name = '<a href="#" histid="' + hist.ID + '">' + Util.textToHtml(Util.formatNZBName(hist.Name)) + '</a>';
		var dupe = DownloadsUI.buildDupe(hist.DupeKey, hist.DupeScore, hist.DupeMode);
		var category = '';

		if (hist.Kind !== 'DUP')
		{
			var category = Util.textToHtml(hist.Category);
		}

		if (hist.Kind === 'URL')
		{
			name += ' <span class="label label-info">URL</span>';
		}
		else if (hist.Kind === 'DUP')
		{
			name += ' <span class="label label-info">hidden</span>';
		}

		if (!UISettings.miniTheme)
		{
			item.fields = ['<div class="check img-check"></div>', status, item.data.time, name + dupe, category, item.data.size];
		}
		else
		{
			var info = '<div class="check img-check"></div><span class="row-title">' + name + '</span>' + dupe +
				' ' + status + ' <span class="label">' + item.data.time + '</span>';
			if (category)
			{
				info += ' <span class="label label-status">' + category + '</span>';
			}
			if (hist.Kind === 'NZB')
			{
				info += ' <span class="label">' + item.data.size + '</span>';
			}
			item.fields = [info];
		}
	}

	function renderCellCallback(cell, index, item)
	{
		if (index === 2)
		{
			cell.className = 'text-center';
		}
		else if (index === 5)
		{
			cell.className = 'text-right';
		}
	}

	this.recordsPerPageChange = function()
	{
		var val = $HistoryRecordsPerPage.val();
		UISettings.write('HistoryRecordsPerPage', val);
		$HistoryTable.fasttable('setPageSize', val);
	}

	function updateInfo(stat)
	{
		updateTabInfo($HistoryTabBadge, stat);
		if (activeTab)
		{
			updateFilterButtons();
		}
	}

	this.deleteClick = function()
	{
		var checkedRows = $HistoryTable.fasttable('checkedRows');
		if (checkedRows.length == 0)
		{
			Notification.show('#Notif_History_Select');
			return;
		}

		var hasNzb = false;
		var hasDup = false;
		var hasFailed = false;
		for (var i = 0; i < history.length; i++)
		{
			var hist = history[i];
			if (checkedRows.indexOf(hist.ID) > -1)
			{
				hasNzb |= hist.Kind === 'NZB';
				hasDup |= hist.Kind === 'DUP';
				hasFailed |= hist.ParStatus === 'FAILURE' || hist.UnpackStatus === 'FAILURE';
			}
		}

		HistoryUI.deleteConfirm(historyDelete, hasNzb, hasDup, hasFailed, true);
	}

	function historyDelete(command)
	{
		Refresher.pause();

		var IDs = $HistoryTable.fasttable('checkedRows');

		RPC.call('editqueue', [command, 0, '', [IDs]], function()
		{
			notification = '#Notif_History_Deleted';
			editCompleted();
		});
	}

	function editCompleted()
	{
		Refresher.update();
		if (notification)
		{
			Notification.show(notification);
			notification = null;
		}
	}

	function editClick(e)
	{
		e.preventDefault();

		var histid = $(this).attr('histid');
		$(this).blur();

		var hist = null;

		// find history object
		for (var i=0; i<history.length; i++)
		{
			var gr = history[i];
			if (gr.ID == histid)
			{
				hist = gr;
				break;
			}
		}
		if (hist == null)
		{
			return;
		}

		HistoryEditDialog.showModal(hist);
	}

	function filterCallback(item)
	{
		return !activeTab || curFilter === 'ALL' || item.hist.FilterKind === curFilter;
	}

	function initFilterButtons()
	{
		Util.show($('#History_Badge_DUPE, #History_Badge_DUPE2').closest('.btn'), Options.option('DupeCheck') === 'yes');
	}

	function updateFilterButtons()
	{
		var countSuccess = 0;
		var countFailure = 0;
		var countDeleted = 0;
		var countDupe = 0;

		var data = $HistoryTable.fasttable('availableContent');

		for (var i=0; i < data.length; i++)
		{
			var hist = data[i].hist;
			switch (hist.FilterKind)
			{
				case 'SUCCESS': countSuccess++; break;
				case 'FAILURE': countFailure++; break;
				case 'DELETED': countDeleted++; break;
				case 'DUPE': countDupe++; break;
			}
		}
		$('#History_Badge_ALL,#History_Badge_ALL2').text(countSuccess + countFailure + countDeleted + countDupe);
		$('#History_Badge_SUCCESS,#History_Badge_SUCCESS2').text(countSuccess);
		$('#History_Badge_FAILURE,#History_Badge_FAILURE2').text(countFailure);
		$('#History_Badge_DELETED,#History_Badge_DELETED2').text(countDeleted);
		$('#History_Badge_DUPE,#History_Badge_DUPE2').text(countDupe);

		$('#HistoryTab_Toolbar .history-filter').removeClass('btn-inverse');
		$('#History_Badge_' + curFilter + ',#History_Badge_' + curFilter + '2').closest('.history-filter').addClass('btn-inverse');
		$('#HistoryTab_Toolbar .badge').removeClass('badge-active');
		$('#History_Badge_' + curFilter + ',#History_Badge_' + curFilter + '2').addClass('badge-active');
	}

	this.filter = function(type)
	{
		curFilter = type;
		History.redraw();
	}

	this.dupClick = function()
	{
		showDup = !showDup;
		$('#History_Dup').toggleClass('btn-inverse', showDup);
		$('#History_DupIcon').toggleClass('icon-mask', !showDup).toggleClass('icon-mask-white', showDup);
		Refresher.update();
	}

}(jQuery));


/*** FUNCTIONS FOR HTML GENERATION (also used from other modules) *****************************/

var HistoryUI = (new function($)
{
	'use strict';

	this.buildStatus = function(status, prefix)
	{
		switch (status)
		{
			case 'success':
			case 'SUCCESS':
			case 'GOOD':
				return '<span class="label label-status label-success">' + prefix + status + '</span>';
			case 'failure':
			case 'FAILURE':
			case 'deleted-health':
				return '<span class="label label-status label-important">' + prefix + status + '</span>';
			case 'BAD':
				return '<span class="label label-status label-important">' + prefix + status + '</span>';
			case 'unknown':
			case 'UNKNOWN':
				return '<span class="label label-status label-info">' + prefix + 'unknown</span>';
			case 'repairable':
			case 'REPAIR_POSSIBLE':
				return '<span class="label label-status label-warning">' + prefix + 'repairable</span>';
			case 'manual':
			case 'MANUAL':
			case 'damaged':
			case 'pp-failure':
			case 'space':
			case 'password':
			case 'SPACE':
			case 'PASSWORD':
				return '<span class="label label-status label-warning">' + prefix + status + '</span>';
			case 'deleted-manual':
				return '<span class="label label-status">' + prefix + 'deleted</span>';
			case 'deleted-dupe':
			case 'edit-deleted-DUPE':
				return '<span class="label label-status">' + prefix + 'dupe</span>';
			case 'edit-deleted-MANUAL':
				return '<span class="label label-status">' + prefix + 'manual</span>';
			case 'edit-deleted-HEALTH':
				return '<span class="label label-status label-important">' + prefix + 'health</span>';
			case 'SCAN_SKIPPED':
				return '<span class="label label-status">' + prefix + 'skipped</span>';
			case 'none':
			case 'NONE':
				return '<span class="label label-status">' + prefix + 'none</span>';
			default:
				return '<span class="label label-status">' + prefix + status + '</span>';
		}
	}

	this.deleteConfirm = function(actionCallback, hasNzb, hasDup, hasFailed, multi)
	{
		var dupeCheck = Options.option('DupeCheck') === 'yes';
		var cleanupDisk = Options.option('DeleteCleanupDisk') === 'yes';
		var dialog = null;

		function init(_dialog)
		{
			dialog = _dialog;

			if (!multi)
			{
				var html = $('#ConfirmDialog_Text').html();
				html = html.replace(/records/g, 'record');
				$('#ConfirmDialog_Text').html(html);
			}

			$('#HistoryDeleteConfirmDialog_Hide', dialog).prop('checked', true);
			Util.show($('#HistoryDeleteConfirmDialog_Options', dialog), hasNzb && dupeCheck);
			Util.show($('#HistoryDeleteConfirmDialog_Simple', dialog), !(hasNzb && dupeCheck));
			Util.show($('#HistoryDeleteConfirmDialog_DeleteWillCleanup', dialog), hasNzb && hasFailed && cleanupDisk);
			Util.show($('#HistoryDeleteConfirmDialog_DeleteCanCleanup', dialog), hasNzb && hasFailed && !cleanupDisk);
			Util.show($('#HistoryDeleteConfirmDialog_DeleteNoCleanup', dialog), !(hasNzb && hasFailed));
			Util.show($('#HistoryDeleteConfirmDialog_DupAlert', dialog), !hasNzb && dupeCheck && hasDup);
			Util.show('#ConfirmDialog_Help', hasNzb && dupeCheck);
		};

		function action()
		{
			var hide = $('#HistoryDeleteConfirmDialog_Hide', dialog).is(':checked');
			var command = hasNzb && hide ? 'HistoryDelete' : 'HistoryFinalDelete';
			actionCallback(command);
		}

		ConfirmDialog.showModal('HistoryDeleteConfirmDialog', action, init);
	}

}(jQuery));
