/*
 * This file is part of nzbget
 *
 * Copyright (C) 2012-2014 Andrey Prygunkov <hugbug@users.sourceforge.net>
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
 * $Revision: 1043 $
 * $Date: 2014-06-13 23:53:27 +0200 (Fri, 13 Jun 2014) $
 *
 */

/*
 * In this module:
 *   1) Download edit dialog;
 *   2) Download multi edit dialog (edit multiple items);
 *   3) Download merge dialog;
 *   4) Download split dialog;
 *   5) History edit dialog.
 */

/*** DOWNLOAD EDIT DIALOG ************************************************************/

var DownloadsEditDialog = (new function($)
{
	'use strict';

	// Controls
	var $DownloadsEditDialog;
	var $DownloadsLogTable;
	var $DownloadsFileTable;
	var $DownloadsEdit_ParamData;
	var $ServStatsTable;

	// State
	var curGroup;
	var notification = null;
	var postParams = [];
	var lastPage;
	var lastFullscreen;
	var logFilled;
	var files;
	var refreshTimer = 0;
	var showing;
	var oldCategory;

	this.init = function()
	{
		$DownloadsEditDialog = $('#DownloadsEditDialog');
		$DownloadsEdit_ParamData = $('#DownloadsEdit_ParamData');

		$('#DownloadsEdit_Save').click(saveChanges);
		$('#DownloadsEdit_Pause').click(itemPause);
		$('#DownloadsEdit_Resume').click(itemResume);
		$('#DownloadsEdit_Delete').click(itemDelete);
		$('#DownloadsEdit_CancelPP').click(itemCancelPP);
		$('#DownloadsEdit_Param, #DownloadsEdit_Log, #DownloadsEdit_File, #DownloadsEdit_Dupe').click(tabClick);
		$('#DownloadsEdit_Back').click(backClick);
		$('#DownloadsEdit_Category').change(categoryChange);

		$DownloadsLogTable = $('#DownloadsEdit_LogTable');
		$DownloadsLogTable.fasttable(
			{
				filterInput: '#DownloadsEdit_LogTable_filter',
				pagerContainer: '#DownloadsEdit_LogTable_pager',
				filterCaseSensitive: false,
				pageSize: 100,
				maxPages: 3,
				hasHeader: true,
				renderCellCallback: logTableRenderCellCallback
			});

		$DownloadsFileTable = $('#DownloadsEdit_FileTable');
		$DownloadsFileTable.fasttable(
			{
				filterInput: '#DownloadsEdit_FileTable_filter',
				pagerContainer: '#DownloadsEdit_FileTable_pager',
				filterCaseSensitive: false,
				headerCheck: '#DownloadsEdit_FileTable > thead > tr:first-child',
				pageSize: 10000,
				hasHeader: true,
				renderCellCallback: fileTableRenderCellCallback
			});

		$ServStatsTable = $('#DownloadsEdit_ServStatsTable');
		$ServStatsTable.fasttable(
			{
				filterInput: '#DownloadsEdit_ServStatsTable_filter',
				pagerContainer: '#DownloadsEdit_ServStatsTable_pager',
				pageSize: 100,
				maxPages: 3,
				hasHeader: true,
				renderCellCallback: EditUI.servStatsTableRenderCellCallback
			});

		$DownloadsFileTable.on('click', 'tbody div.check',
			function(event) { $DownloadsFileTable.fasttable('itemCheckClick', this.parentNode.parentNode, event); });
		$DownloadsFileTable.on('click', 'thead div.check',
			function() { $DownloadsFileTable.fasttable('titleCheckClick') });
		$DownloadsFileTable.on('mousedown', Util.disableShiftMouseDown);

		$DownloadsEditDialog.on('hidden', function()
		{
			// cleanup
			$DownloadsLogTable.fasttable('update', []);
			$DownloadsFileTable.fasttable('update', []);
			$DownloadsEdit_ParamData.empty();
			clearTimeout(refreshTimer);
			// resume updates
			Refresher.resume();
		});

		TabDialog.extend($DownloadsEditDialog);

		if (UISettings.setFocus)
		{
			$DownloadsEditDialog.on('shown', function()
			{
				if ($('#DownloadsEdit_NZBName').is(":visible"))
				{
					$('#DownloadsEdit_NZBName').focus();
				}
			});
		}
	}

	this.showModal = function(nzbid, allGroups, area)
	{
		var group = null;

		// find Group object
		for (var i=0; i<allGroups.length; i++)
		{
			var gr = allGroups[i];
			if (gr.NZBID == nzbid)
			{
				group = gr;
				break;
			}
		}
		if (group == null)
		{
			return;
		}

		Refresher.pause();

		curGroup = group;

		var status = DownloadsUI.buildStatus(group);
		var age = Util.formatAge(group.MinPostTime + UISettings.timeZoneCorrection*60*60);
		var size = Util.formatSizeMB(group.FileSizeMB, group.FileSizeLo);
		var remaining = Util.formatSizeMB(group.RemainingSizeMB-group.PausedSizeMB, group.RemainingSizeLo-group.PausedSizeLo);
		var pausedSize = Util.formatSizeMB(group.PausedSizeMB, group.PausedSizeLo);
		var estimated = group.Status === 'PAUSED' ? '' : (Status.status.DownloadRate > 0 ? Util.formatTimeHMS((group.RemainingSizeMB-group.PausedSizeMB)*1024/(Status.status.DownloadRate/1024)) : '');
		var completion = group.SuccessArticles + group.FailedArticles > 0 ? Util.round0(group.SuccessArticles * 100.0 / (group.SuccessArticles +  group.FailedArticles)) + '%' : '--';

		var table = '';
		//table += '<tr><td>Age</td><td class="text-right">' + age + '</td></tr>';
		table += '<tr><td>Total</td><td class="text-right">' + size + '</td></tr>';
		table += '<tr><td>Paused</td><td class="text-right">' + pausedSize + '</td></tr>';
		table += '<tr><td>Unpaused</td><td class="text-right">' + remaining + '</td></tr>';
		//table += '<tr><td>Size (total/remaining/paused)</td><td class="text-right">4.10 / 4.10 / 0.00 GB</td></tr>';
		//table += '<tr><td>Active downloads</td><td class="text-right">' + group.ActiveDownloads + '</td></tr>';
		//table += '<tr><td>Estimated time</td><td class="text-right">' + estimated + '</td></tr>';
		table += '<tr><td>Health (critical/current)</td><td class="text-right">' +
			Math.floor(group.CriticalHealth / 10) + '% / ' + Math.floor(group.Health / 10) + '%</td></tr>';
		table += '<tr><td>Files (total/remaining/pars)</td><td class="text-right">' + group.FileCount + ' / ' +
			group.RemainingFileCount + ' / ' + group.RemainingParCount + '</td></tr>';
		table += '<tr><td>' +
			(group.ServerStats.length > 0 ? '<a href="#" id="DownloadsEdit_ServStats" data-tab="DownloadsEdit_ServStatsTab" title="Per-server statistics">' : '') +
			'Articles (total/completion)' +
			(group.ServerStats.length > 0 ? ' <i class="icon-forward" style="opacity:0.6;"></i></a>' : '') +
			'</td><td class="text-right">' + group.TotalArticles + ' / ' + completion + '</td></tr>';
		$('#DownloadsEdit_Statistics').html(table);

		$('#DownloadsEdit_ServStats').click(tabClick);
		EditUI.fillServStats($ServStatsTable, group);
		$ServStatsTable.fasttable('setCurPage', 1);

		$('#DownloadsEdit_Title').html(Util.formatNZBName(group.NZBName) +
		    (group.Kind === 'URL' ? '&nbsp;<span class="label label-info">URL</span>' : ''));

		$('#DownloadsEdit_NZBName').attr('value', group.NZBName);
		$('#DownloadsEdit_NZBName').attr('readonly', group.postprocess);
		$('#DownloadsEdit_URL').attr('value', group.URL);

		// Priority
		var v = $('#DownloadsEdit_Priority');
		DownloadsUI.fillPriorityCombo(v);
		v.val(group.MaxPriority);
		if (v.val() != group.MaxPriority)
		{
			v.append('<option selected="selected">' + group.MaxPriority +'</option>');
		}
		v.attr('disabled', 'disabled');

		// Category
		v = $('#DownloadsEdit_Category');
		DownloadsUI.fillCategoryCombo(v);
		v.val(group.Category);
		if (v.val() != group.Category)
		{
			v.append($('<option selected="selected"></option>').text(group.Category));
		}

		// duplicate settings
		$('#DownloadsEdit_DupeKey').val(group.DupeKey);
		$('#DownloadsEdit_DupeScore').val(group.DupeScore);
		$('#DownloadsEdit_DupeMode').val(group.DupeMode);

		$DownloadsLogTable.fasttable('update', []);
		$DownloadsFileTable.fasttable('update', []);

		var postParamConfig = ParamTab.createPostParamConfig();

		Util.show('#DownloadsEdit_NZBNameReadonly', group.postprocess);
		Util.show('#DownloadsEdit_CancelPP', group.postprocess);
		Util.show('#DownloadsEdit_Delete', !group.postprocess);
		Util.show('#DownloadsEdit_Pause', group.Kind === 'NZB' && !group.postprocess);
		Util.show('#DownloadsEdit_Resume', false);
		Util.show('#DownloadsEdit_Save', !group.postprocess);
		Util.show('#DownloadsEdit_StatisticsGroup', group.Kind === 'NZB');
		Util.show('#DownloadsEdit_File', group.Kind === 'NZB');
		Util.show('#DownloadsEdit_URLGroup', group.Kind === 'URL');
		$('#DownloadsEdit_CategoryGroup').toggleClass('control-group-last', group.Kind === 'URL');
		var dupeCheck = Options.option('DupeCheck') === 'yes';
		Util.show('#DownloadsEdit_Dupe', dupeCheck);
		var postParam = postParamConfig[0].options.length > 0 && group.Kind === 'NZB';
		var postLog = group.postprocess && group.Log.length > 0;
		Util.show('#DownloadsEdit_Param', postParam);
		Util.show('#DownloadsEdit_Log', postLog);

		if (group.postprocess)
		{
			$('#DownloadsEdit_NZBName').attr('disabled', 'disabled');
			$('#DownloadsEdit_Priority').attr('disabled', 'disabled');
			$('#DownloadsEdit_Category').attr('disabled', 'disabled');
			$('#DownloadsEdit_Close').addClass('btn-primary');
			$('#DownloadsEdit_Close').text('Close');
		}
		else
		{
			$('#DownloadsEdit_NZBName').removeAttr('disabled');
			$('#DownloadsEdit_Priority').removeAttr('disabled');
			$('#DownloadsEdit_Category').removeAttr('disabled');
			$('#DownloadsEdit_Close').removeClass('btn-primary');
			$('#DownloadsEdit_Close').text('Cancel');

			if (group.RemainingSizeHi == group.PausedSizeHi && group.RemainingSizeLo == group.PausedSizeLo &&
			    group.Kind === 'NZB')
			{
				$('#DownloadsEdit_Resume').show();
				$('#DownloadsEdit_Pause').hide();
			}
		}

		if (postParam)
		{
			postParams = ParamTab.buildPostParamTab($DownloadsEdit_ParamData, postParamConfig, curGroup.Parameters);
		}

		EditUI.buildDNZBLinks(curGroup.Parameters, 'DownloadsEdit_DNZB');

		enableAllButtons();

		$('#DownloadsEdit_GeneralTab').show();
		$('#DownloadsEdit_ParamTab').hide();
		$('#DownloadsEdit_ServStatsTab').hide();
		$('#DownloadsEdit_LogTab').hide();
		$('#DownloadsEdit_FileTab').hide();
		$('#DownloadsEdit_DupeTab').hide();
		$('#DownloadsEdit_Back').hide();
		$('#DownloadsEdit_BackSpace').show();
		$DownloadsEditDialog.restoreTab();

		$('#DownloadsEdit_FileTable_filter').val('');
		$('#DownloadsEdit_LogTable_filter').val('');
		$('#DownloadsEdit_LogTable_pagerBlock').hide();

		files = null;
		logFilled = false;
		notification = null;
		oldCategory = curGroup.Category;

		if (area === 'backup')
		{
			showing = true;
			$('#DownloadsEdit_ServStats').trigger('click');
		}
		showing = false;

		$DownloadsEditDialog.modal({backdrop: 'static'});
	}

	function completed()
	{
		$DownloadsEditDialog.modal('hide');
		Refresher.update();
		if (notification)
		{
			Notification.show(notification);
			notification = null;
		}
	}

	function tabClick(e)
	{
		e.preventDefault();

		$('#DownloadsEdit_Back').fadeIn(showing ? 0 : 500);
		$('#DownloadsEdit_BackSpace').hide();
		var tab = '#' + $(this).attr('data-tab');
		lastPage = $(tab);
		lastFullscreen = ($(this).attr('data-fullscreen') === 'true') && !UISettings.miniTheme;

		$('#DownloadsEdit_FileBlock').removeClass('modal-inner-scroll');
		$('#DownloadsEdit_FileBlock').css('top', '');

		if (UISettings.miniTheme && files === null)
		{
			$('#DownloadsEdit_FileBlock').css('min-height', $DownloadsEditDialog.height());
		}

		if (UISettings.miniTheme && !logFilled)
		{
			$('#DownloadsEdit_LogBlock').css('min-height', $DownloadsEditDialog.height());
		}

		$DownloadsEditDialog.switchTab($('#DownloadsEdit_GeneralTab'), lastPage,
			e.shiftKey || !UISettings.slideAnimation || showing ? 0 : 500,
			{fullscreen: lastFullscreen, mini: UISettings.miniTheme, complete: function()
				{
					if (!UISettings.miniTheme)
					{
						$('#DownloadsEdit_FileBlock').css('top', $('#DownloadsEdit_FileBlock').position().top);
						$('#DownloadsEdit_FileBlock').addClass('modal-inner-scroll');
					}
					else
					{
						$('#DownloadsEdit_FileBlock').css('min-height', '');
						$('#DownloadsEdit_LogBlock').css('min-height', '');
					}
				}});

		if (tab === '#DownloadsEdit_LogTab' && !logFilled && curGroup.postprocess &&
			curGroup.Log && curGroup.Log.length > 0)
		{
			fillLog();
		}

		if (tab === '#DownloadsEdit_FileTab' && files === null)
		{
			fillFiles();
		}

		if (tab === '#DownloadsEdit_ServStatsTab')
		{
			scheduleRefresh();
		}
	}

	function backClick(e)
	{
		e.preventDefault();
		$('#DownloadsEdit_Back').fadeOut(500, function()
		{
			$('#DownloadsEdit_BackSpace').show();
		});

		$('#DownloadsEdit_FileBlock').removeClass('modal-inner-scroll');
		$('#DownloadsEdit_FileBlock').css('top', '');

		$DownloadsEditDialog.switchTab(lastPage, $('#DownloadsEdit_GeneralTab'),
			e.shiftKey || !UISettings.slideAnimation ? 0 : 500,
			{fullscreen: lastFullscreen, mini: UISettings.miniTheme, back: true});

		clearTimeout(refreshTimer);
	}

	function disableAllButtons()
	{
		$('#DownloadsEditDialog .modal-footer .btn').attr('disabled', 'disabled');
		setTimeout(function()
		{
			$('#DownloadsEdit_Transmit').show();
		}, 500);
	}

	function enableAllButtons()
	{
		$('#DownloadsEditDialog .modal-footer .btn').removeAttr('disabled');
		$('#DownloadsEdit_Transmit').hide();
	}

	function saveChanges(e)
	{
		e.preventDefault();
		disableAllButtons();
		notification = null;
		saveName();
	}

	function saveName()
	{
		var name = $('#DownloadsEdit_NZBName').val();
		name !== curGroup.NZBName && !curGroup.postprocess ?
			RPC.call('editqueue', ['GroupSetName', 0, name, [curGroup.NZBID]], function()
			{
				notification = '#Notif_Downloads_Saved';
				savePriority();
			})
			:savePriority();
	}

	function savePriority()
	{
		var priority = parseInt($('#DownloadsEdit_Priority').val());
		priority !== curGroup.MaxPriority ?
			RPC.call('editqueue', ['GroupSetPriority', 0, ''+priority, [curGroup.NZBID]], function()
			{
				notification = '#Notif_Downloads_Saved';
				saveCategory();
			})
			: saveCategory();
	}

	function saveCategory()
	{
		var category = $('#DownloadsEdit_Category').val();
		category !== curGroup.Category ?
			RPC.call('editqueue', ['GroupSetCategory', 0, category, [curGroup.NZBID]], function()
			{
				notification = '#Notif_Downloads_Saved';
				saveDupeKey();
			})
			: saveDupeKey();
	}

	function itemPause(e)
	{
		e.preventDefault();
		disableAllButtons();
		notification = '#Notif_Downloads_Paused';
		RPC.call('editqueue', ['GroupPause', 0, '', [curGroup.NZBID]], completed);
	}

	function itemResume(e)
	{
		e.preventDefault();
		disableAllButtons();
		notification = '#Notif_Downloads_Resumed';
		RPC.call('editqueue', ['GroupResume', 0, '', [curGroup.NZBID]], function()
		{
			if (Options.option('ParCheck') === 'force')
			{
				completed();
			}
			else
			{
				RPC.call('editqueue', ['GroupPauseExtraPars', 0, '', [curGroup.NZBID]], completed);
			}
		});
	}

	function itemDelete(e)
	{
		e.preventDefault();
		DownloadsUI.deleteConfirm(doItemDelete, false, curGroup.Kind === 'NZB', curGroup.Kind === 'URL');
	}

	function doItemDelete(command)
	{
		disableAllButtons();
		notification = '#Notif_Downloads_Deleted';
		RPC.call('editqueue', [command, 0, '', [curGroup.NZBID]], completed);
	}

	function itemCancelPP(e)
	{
		e.preventDefault();
		disableAllButtons();
		notification = '#Notif_Downloads_PostCanceled';

		var postDelete = function()
		{
			RPC.call('editqueue', ['PostDelete', 0, '', [curGroup.NZBID]], completed);
		};

		if (curGroup.NZBID > 0)
		{
			RPC.call('editqueue', ['GroupDelete', 0, '', [curGroup.NZBID]], postDelete);
		}
		else
		{
			postDelete();
		}
	}

	function categoryChange()
	{
		var category = $('#DownloadsEdit_Category').val();
		ParamTab.reassignParams(postParams, oldCategory, category);
		oldCategory = category;
	}
	
	/*** TAB: POST-PROCESSING PARAMETERS **************************************************/

	function saveParam()
	{
		if (curGroup.Kind === 'URL')
		{
			completed();
			return;
		}

		var paramList = ParamTab.prepareParamRequest(postParams);
		saveNextParam(paramList);
	}

	function saveNextParam(paramList)
	{
		if (paramList.length > 0)
		{
			RPC.call('editqueue', ['GroupSetParameter', 0, paramList[0], [curGroup.NZBID]], function()
			{
				notification = '#Notif_Downloads_Saved';
				paramList.shift();
				saveNextParam(paramList);
			})
		}
		else
		{
			saveFiles();
		}
	}

	/*** TAB: DUPLICATE SETTINGS **************************************************/

	function saveDupeKey()
	{
		var value = $('#DownloadsEdit_DupeKey').val();
		value !== curGroup.DupeKey ?
			RPC.call('editqueue', ['GroupSetDupeKey', 0, value, [curGroup.NZBID]], function()
			{
				notification = '#Notif_Downloads_Saved';
				saveDupeScore();
			})
			:saveDupeScore();
	}

	function saveDupeScore()
	{
		var value = $('#DownloadsEdit_DupeScore').val();
		value != curGroup.DupeScore ?
			RPC.call('editqueue', ['GroupSetDupeScore', 0, value, [curGroup.NZBID]], function()
			{
				notification = '#Notif_Downloads_Saved';
				saveDupeMode();
			})
			:saveDupeMode();
	}

	function saveDupeMode()
	{
		var value = $('#DownloadsEdit_DupeMode').val();
		value !== curGroup.DupeMode ?
			RPC.call('editqueue', ['GroupSetDupeMode', 0, value, [curGroup.NZBID]], function()
			{
				notification = '#Notif_Downloads_Saved';
				saveParam();
			})
			:saveParam();
	}

	/*** TAB: LOG *************************************************************************/

	function fillLog()
	{
		logFilled = true;
		var data = [];

		for (var i=0; i < curGroup.Log.length; i++)
		{
			var message = curGroup.Log[i];

			var kind;
			switch (message.Kind)
			{
				case 'INFO': kind = '<span class="label label-status label-success">info</span>'; break;
				case 'DETAIL': kind = '<span class="label label-status label-info">detail</span>'; break;
				case 'WARNING': kind = '<span class="label label-status label-warning">warning</span>'; break;
				case 'ERROR': kind = '<span class="label label-status label-important">error</span>'; break;
				case 'DEBUG': kind = '<span class="label label-status">debug</span>'; break;
			}

			var text = Util.textToHtml(message.Text);
			var time = Util.formatDateTime(message.Time + UISettings.timeZoneCorrection*60*60);
			var fields;

			if (!UISettings.miniTheme)
			{
				fields = [kind, time, text];
			}
			else
			{
				var info = kind + ' <span class="label">' + time + '</span> ' + text;
				fields = [info];
			}

			var item =
			{
				id: message,
				fields: fields,
				search: message.Kind + ' ' + time + ' ' + message.Text
			};

			data.unshift(item);
		}

		$DownloadsLogTable.fasttable('update', data);
		$DownloadsLogTable.fasttable('setCurPage', 1);
		Util.show('#DownloadsEdit_LogTable_pagerBlock', data.length > 100);
	}

	function logTableRenderCellCallback(cell, index, item)
	{
		if (index === 0)
		{
			cell.width = '65px';
		}
	}

	/*** TAB: FILES *************************************************************************/

	function fillFiles()
	{
		$('.loading-block', $DownloadsEditDialog).show();
		RPC.call('listfiles', [0, 0, curGroup.NZBID], filesLoaded);
	}

	function filesLoaded(fileArr)
	{
		$('.loading-block', $DownloadsEditDialog).hide();

		files = fileArr;

		var data = [];

		for (var i=0; i < files.length; i++)
		{
			var file = files[i];

			if (!file.status)
			{
				file.status = file.Paused ? (file.ActiveDownloads > 0 ? 'pausing' : 'paused') : (file.ActiveDownloads > 0 ? 'downloading' : 'queued');
			}

			var age = Util.formatAge(file.PostTime + UISettings.timeZoneCorrection*60*60);
			var size = Util.formatSizeMB(0, file.FileSizeLo);
			if (file.FileSizeLo !== file.RemainingSizeLo)
			{
				size = '(' + Util.round0(file.RemainingSizeLo / file.FileSizeLo * 100) + '%) ' + size;
			}

			var status;
			switch (file.status)
			{
				case 'downloading':
				case 'pausing': status = '<span class="label label-status label-success">' + file.status + '</span>'; break;
				case 'paused': status = '<span class="label label-status label-warning">paused</span>'; break;
				case 'queued': status = '<span class="label label-status">queued</span>'; break;
				case 'deleted': status = '<span class="label label-status label-important">deleted</span>'; break;
				default: status = '<span class="label label-status label-important">internal error(' + file.status + ')</span>';
			}

			var name = Util.textToHtml(file.Filename);
			var fields;

			if (!UISettings.miniTheme)
			{
				var info = name;
				fields = ['<div class="check img-check"></div>', status, info, age, size];
			}
			else
			{
				var info = '<div class="check img-check"></div><span class="row-title">' + name + '</span>' +
					' ' + (file.status === 'queued' ? '' : status);
				fields = [info];
			}

			var item =
			{
				id: file.ID,
				file: file,
				fields: fields,
				search: file.status + ' ' + file.Filename + ' ' + age + ' ' + size
			};

			data.push(item);
		}

		$DownloadsFileTable.fasttable('update', data);
		$DownloadsFileTable.fasttable('setCurPage', 1);
	}

	function fileTableRenderCellCallback(cell, index, item)
	{
		if (index > 2)
		{
			cell.className = 'text-right';
		}
	}

	this.editActionClick = function(action)
	{
		if (files.length == 0)
		{
			return;
		}

		var checkedRows = $DownloadsFileTable.fasttable('checkedRows');
		if (checkedRows.length == 0)
		{
			Notification.show('#Notif_Edit_Select');
			return;
		}

		for (var i = 0; i < files.length; i++)
		{
			var file = files[i];
			file.moved = false;
		}

		var editIDList = [];
		var splitError = false;

		for (var i = 0; i < files.length; i++)
		{
			var n = i;
			if (action === 'down' || action === 'top')
			{
				// iterate backwards in the file list
				n = files.length-1-i;
			}
			var file = files[n];

			if (checkedRows.indexOf(file.ID) > -1)
			{
				editIDList.push(file.ID);

				switch (action)
				{
					case 'pause':
						file.status = 'paused';
						file.editAction = action;
						break;
					case 'resume':
						file.status = 'queued';
						file.editAction = action;
						break;
					case 'delete':
						file.status = 'deleted';
						file.editAction = action;
						break;
					case 'top':
						if (!file.moved)
						{
							files.splice(n, 1);
							files.unshift(file);
							file.moved = true;
							file.editMoved = true;
							i--;
						}
						break;
					case 'up':
						if (!file.moved && i > 0)
						{
							files.splice(i, 1);
							files.splice(i-1, 0, file);
							file.moved = true;
							file.editMoved = true;
						}
						break;
					case 'down':
						if (!file.moved && i > 0)
						{
							files.splice(n, 1);
							files.splice(n+1, 0, file);
							file.moved = true;
							file.editMoved = true;
						}
						break;
					case 'bottom':
						if (!file.moved)
						{
							files.splice(i, 1);
							files.push(file);
							file.moved = true;
							file.editMoved = true;
							i--;
						}
						break;
					case 'split':
						if (file.ActiveDownloads > 0 || file.FileSizeLo !== file.RemainingSizeLo)
						{
							splitError = true;
						}
						break;
				}
			}
		}

		if (action === 'split')
		{
			if (splitError)
			{
				Notification.show('#Notif_Downloads_SplitNotPossible');
			}
			else
			{
				DownloadsSplitDialog.showModal(curGroup, editIDList);
			}
		}

		filesLoaded(files);
	}

	function saveFilesActions(actions, commands)
	{
		if (actions.length === 0 || !files || files.length === 0)
		{
			saveFileOrder();
			return;
		}

		var action = actions.shift();
		var command = commands.shift();

		var IDs = [];
		for (var i = 0; i < files.length; i++)
		{
			var file = files[i];
			if (file.editAction === action)
			{
				IDs.push(file.ID);
			}
		}

		if (IDs.length > 0)
		{
			RPC.call('editqueue', [command, 0, '', IDs], function()
			{
				notification = '#Notif_Downloads_Saved';
				saveFilesActions(actions, commands);
			})
		}
		else
		{
			saveFilesActions(actions, commands);
		}
	}

	function saveFiles()
	{
		saveFilesActions(['pause', 'resume', 'delete'], ['FilePause', 'FileResume', 'FileDelete']);
	}

	function saveFileOrder()
	{
		if (!files || files.length === 0)
		{
			completed();
			return;
		}

		var IDs = [];
		var hasMovedFiles = false;
		for (var i = 0; i < files.length; i++)
		{
			var file = files[i];
			IDs.push(file.ID);
			hasMovedFiles |= file.editMoved;
		}

		if (hasMovedFiles)
		{
			RPC.call('editqueue', ['FileReorder', 0, '', IDs], function()
			{
				notification = '#Notif_Downloads_Saved';
				completed();
			})
		}
		else
		{
			completed();
		}
	}

	/*** TAB: PER-SERVER STATUSTICS *****************************************************************/

	function scheduleRefresh()
	{
		refreshTimer = setTimeout(updateServStats, UISettings.refreshInterval * 1000);
	}

	function updateServStats()
	{
		RPC.call('listgroups', [], groups_loaded);
	}

	function groups_loaded(groups)
	{
		for (var i=0, il=groups.length; i < il; i++)
		{
			var group = groups[i];
			if (group.NZBID === curGroup.NZBID)
			{
				curGroup.ServerStats = group.ServerStats;
				EditUI.fillServStats($ServStatsTable, group);
				scheduleRefresh();
				break;
			}
		}
	}
}(jQuery));


/*** COMMON FUNCTIONS FOR EDIT DIALOGS ************************************************************/

var EditUI = (new function($)
{
	'use strict'

	this.buildDNZBLinks = function(parameters, prefix)
	{
		$('.' + prefix).hide();
		var hasItems = false;

		for (var i=0; i < parameters.length; i++)
		{
			var param = parameters[i];
			if (param.Name.substr(0, 6) === '*DNZB:')
			{
				var linkName = param.Name.substr(6, 100);
				var $paramLink = $('#' + prefix + '_' + linkName);
				if($paramLink.length > 0)
				{
					$paramLink.attr('href', param.Value);
					$paramLink.show();
					hasItems = true;
				}
			}
		}

		Util.show('#' + prefix + '_Section', hasItems);
	}

	/*** TAB: SERVER STATISTICS **************************************************/

	this.fillServStats = function(table, editItem)
	{
		var data = [];
		for (var i=0; i < Status.status.NewsServers.length; i++)
		{
			var server = Status.status.NewsServers[i];
			var name = Options.option('Server' + server.ID + '.Name');
			if (name === null || name === '')
			{
				var host = Options.option('Server' + server.ID + '.Host');
				var port = Options.option('Server' + server.ID + '.Port');
				name = (host === null ? '' : host) + ':' + (port === null ? '119' : port);
			}

			var articles = '--';
			var artquota = '--';
			var success = '--';
			var failures = '--';
			for (var j=0; j < editItem.ServerStats.length; j++)
			{
				var stat = editItem.ServerStats[j];
				if (stat.ServerID === server.ID && stat.SuccessArticles + stat.FailedArticles > 0)
				{
					articles = stat.SuccessArticles + stat.FailedArticles;
					artquota = Util.round0(articles * 100.0 / (editItem.SuccessArticles + editItem.FailedArticles)) + '%';
					success = Util.round0(stat.SuccessArticles * 100.0 / articles) + '%';
					failures = Util.round0(stat.FailedArticles * 100.0 / articles) + '%';
					break;
				}
			}

			var fields = [server.ID + '. ' + name, articles, artquota, success, failures];
			var item =
			{
				id: server.ID,
				fields: fields,
				search: ''
			};
			data.push(item);
		}
		table.fasttable('update', data);
	}

	this.servStatsTableRenderCellCallback = function (cell, index, item)
	{
		if (index > 0)
		{
			cell.className = 'text-right';
		}
	}
}(jQuery));


/*** PARAM TAB FOR EDIT DIALOGS ************************************************************/

var ParamTab = (new function($)
{
	'use strict'

	this.buildPostParamTab = function(configData, postParamConfig, parameters)
	{
		var postParams = $.extend(true, [], postParamConfig);
		Options.mergeValues(postParams, parameters);
		var content = Config.buildOptionsContent(postParams[0]);
		configData.empty();
		configData.append(content);
		configData.addClass('retain-margin');

		var lastClass = '';
		var lastDiv = null;
		for (var i=0; i < configData.children().length; i++)
		{
			var div = $(configData.children()[i]);
			var divClass = div.attr('class');
			if (divClass != lastClass && lastClass != '')
			{
				lastDiv.addClass('wants-divider');
			}
			lastDiv = div;
			lastClass = divClass;
		}
		return postParams;
	}

	this.createPostParamConfig = function()
	{
		var postParamConfig = Options.postParamConfig;
		defineBuiltinParams(postParamConfig);
		return postParamConfig;
	}

	function defineBuiltinParams(postParamConfig)
	{
	    if (postParamConfig.length == 0)
	    {
	        postParamConfig.push({category: 'P', postparam: true, options: []});
	    }

		if (!Options.findOption(postParamConfig[0].options, '*Unpack:'))
		{
			postParamConfig[0].options.unshift({name: '*Unpack:Password', value: '', defvalue: '', select: [], caption: 'Password', sectionId: '_Unpack_', description: 'Unpack-password for encrypted archives.'});
			postParamConfig[0].options.unshift({name: '*Unpack:', value: '', defvalue: 'yes', select: ['yes', 'no'], caption: 'Unpack', sectionId: '_Unpack_', description: 'Unpack rar and 7-zip archives.'});
		}
	}

	this.prepareParamRequest = function(postParams)
	{
		var request = [];
		for (var i=0; i < postParams.length; i++)
		{
			var section = postParams[i];
			for (var j=0; j < section.options.length; j++)
			{
				var option = section.options[j];
				if (!option.template && !section.hidden)
				{
					var oldValue = option.value;
					var newValue = Config.getOptionValue(option);
					if (oldValue != newValue && !((oldValue === null || oldValue === '') && newValue === option.defvalue))
					{
						var opt = option.name + '=' + newValue;
						request.push(opt);
					}
				}
			}
		}
		return request;
	}

	function buildCategoryScriptList(category)
	{
		var scriptList = [];

		for (var i=0; i < Options.categories.length; i++)
		{
			if (category === Options.categories[i])
			{
				scriptList = Util.parseCommaList(Options.option('Category' + (i + 1) + '.PostScript'));
				if (scriptList.length === 0)
				{
					scriptList = Util.parseCommaList(Options.option('PostScript'));
				}
				if (Options.option('Category' + (i + 1) + '.Unpack') === 'yes')
				{
					scriptList.push('*Unpack');
				}
				return scriptList;
			}
		}
		
		// empty category or category not found
		scriptList = Util.parseCommaList(Options.option('PostScript'));
		if (Options.option('Unpack') === 'yes')
		{
			scriptList.push('*Unpack');
		}
		return scriptList;
	}
	
	this.reassignParams = function(postParams, oldCategory, newCategory)
	{
		var oldScriptList = buildCategoryScriptList(oldCategory);
		var newScriptList = buildCategoryScriptList(newCategory);

		for (var i=0; i < postParams.length; i++)
		{
			var section = postParams[i];
			for (var j=0; j < section.options.length; j++)
			{
				var option = section.options[j];
				if (!option.template && !section.hidden && option.name.substr(option.name.length - 1, 1) === ':')
				{
					console.log(option.name);
					var scriptName = option.name.substr(0, option.name.length-1);
					if (oldScriptList.indexOf(scriptName) > -1 && newScriptList.indexOf(scriptName) === -1)
					{
						Config.setOptionValue(option, 'no');
					}
					else if (oldScriptList.indexOf(scriptName) === -1 && newScriptList.indexOf(scriptName) > -1)
					{
						Config.setOptionValue(option, 'yes');
					}
				}
			}
		}
	}

}(jQuery));


/*** DOWNLOAD MULTI EDIT DIALOG ************************************************************/

var DownloadsMultiDialog = (new function($)
{
	'use strict'

	// Controls
	var $DownloadsMultiDialog;

	// State
	var multiIDList;
	var notification = null;
	var oldPriority;
	var oldCategory;

	this.init = function()
	{
		$DownloadsMultiDialog = $('#DownloadsMultiDialog');

		$('#DownloadsMulti_Save').click(saveChanges);

		$DownloadsMultiDialog.on('hidden', function ()
		{
			Refresher.resume();
		});

		if (UISettings.setFocus)
		{
			$DownloadsMultiDialog.on('shown', function ()
			{
				if ($('#DownloadsMulti_Priority').is(":visible"))
				{
					$('#DownloadsMulti_Priority').focus();
				}
			});
		}
	}

	this.showModal = function(nzbIdList, allGroups)
	{
		var groups = [];
		multiIDList = [];

		for (var i=0; i<allGroups.length; i++)
		{
			var gr = allGroups[i];
			if (nzbIdList.indexOf(gr.NZBID) > -1)
			{
				groups.push(gr);
				multiIDList.push(gr.NZBID);
			}
		}
		if (groups.length == 0)
		{
			return;
		}

		Refresher.pause();

		var FileSizeMB = 0, FileSizeLo = 0;
		var RemainingSizeMB = 0, RemainingSizeLo = 0;
		var PausedSizeMB = 0, PausedSizeLo = 0;
		var FileCount = 0, RemainingFileCount = 0, RemainingParCount = 0;
		var paused = true;
		var Priority = groups[0].MaxPriority;
		var PriorityDiff = false;
		var Category = groups[0].Category;
		var CategoryDiff = false;

		for (var i=0; i<groups.length; i++)
		{
			var group = groups[i];
			FileSizeMB += group.FileSizeMB;
			RemainingSizeMB += group.RemainingSizeMB;
			RemainingSizeLo += group.RemainingSizeLo;
			PausedSizeMB += group.PausedSizeMB;
			PausedSizeLo += group.PausedSizeLo;
			FileCount += group.FileCount;
			RemainingFileCount += group.RemainingFileCount;
			RemainingParCount += group.RemainingParCount;
			paused = paused && group.Status === 'PAUSED';
			PriorityDiff = PriorityDiff || (Priority !== group.MaxPriority);
			CategoryDiff = CategoryDiff || (Category !== group.Category);
		}

		var size = Util.formatSizeMB(FileSizeMB, FileSizeLo);
		var remaining = Util.formatSizeMB(RemainingSizeMB-PausedSizeMB, RemainingSizeLo-PausedSizeLo);
		var unpausedSize = Util.formatSizeMB(PausedSizeMB, PausedSizeLo);
		var estimated = paused ? '' : (Status.status.DownloadRate > 0 ? Util.formatTimeHMS((RemainingSizeMB-PausedSizeMB)*1024/(Status.status.DownloadRate/1024)) : '');

		var table = '';
		table += '<tr><td>Total</td><td class="text-right">' + size + '</td></tr>';
		table += '<tr><td>Paused</td><td class="text-right">' + unpausedSize + '</td></tr>';
		table += '<tr><td>Unpaused</td><td class="text-right">' + remaining + '</td></tr>';
		table += '<tr><td>Estimated time</td><td class="text-right">' + estimated + '</td></tr>';
		table += '<tr><td>Files (total/remaining/pars)</td><td class="text-center">' + FileCount + ' / ' +
			RemainingFileCount + ' / ' + RemainingParCount + '</td></tr>';
		$('#DownloadsMulti_Statistics').html(table);

		$('#DownloadsMulti_Title').text('Multiple records (' + groups.length + ')');

		// Priority
		var v = $('#DownloadsMulti_Priority');
		DownloadsUI.fillPriorityCombo(v);
		v.val(Priority);
		if (v.val() != Priority)
		{
			v.append('<option>' + Priority +'</option>');
			v.val(Priority);
		}
		if (PriorityDiff)
		{
			v.append('<option selected="selected">&lt;multiple values&gt;</option>');
		}
		oldPriority = v.val();
		$('#DownloadsMulti_Priority').removeAttr('disabled');

		// Category
		var v = $('#DownloadsMulti_Category');
		DownloadsUI.fillCategoryCombo(v);
		v.val(Category);
		if (v.val() != Category)
		{
			v.append($('<option></option>').text(Category));
			v.val(Category);
		}
		if (CategoryDiff)
		{
			v.append('<option selected="selected">&lt;multiple values&gt;</option>');
		}
		oldCategory = v.val();

		enableAllButtons();
		$('#DownloadsMulti_GeneralTabLink').tab('show');

		notification = null;

		$DownloadsMultiDialog.modal({backdrop: 'static'});
	}

	function enableAllButtons()
	{
		$('#DownloadsMulti .modal-footer .btn').removeAttr('disabled');
		$('#DownloadsMulti_Transmit').hide();
	}

	function disableAllButtons()
	{
		$('#DownloadsMulti .modal-footer .btn').attr('disabled', 'disabled');
		setTimeout(function()
		{
			$('#DownloadsMulti_Transmit').show();
		}, 500);
	}

	function saveChanges(e)
	{
		e.preventDefault();
		disableAllButtons();
		savePriority();
	}

	function savePriority()
	{
		var priority = $('#DownloadsMulti_Priority').val();
		(priority !== oldPriority && priority !== '<multiple values>') ?
			RPC.call('editqueue', ['GroupSetPriority', 0, priority, multiIDList], function()
			{
				notification = '#Notif_Downloads_Saved';
				saveCategory();
			})
			: saveCategory();
	}

	function saveCategory()
	{
		var category = $('#DownloadsMulti_Category').val();
		(category !== oldCategory && category !== '<multiple values>') ?
			RPC.call('editqueue', ['GroupApplyCategory', 0, category, multiIDList], function()
			{
				notification = '#Notif_Downloads_Saved';
				completed();
			})
			: completed();
	}

	function completed()
	{
		$DownloadsMultiDialog.modal('hide');
		Refresher.update();
		if (notification)
		{
			Notification.show(notification);
		}
	}
}(jQuery));


/*** DOWNLOAD MERGE DIALOG ************************************************************/

var DownloadsMergeDialog = (new function($)
{
	'use strict'

	// Controls
	var $DownloadsMergeDialog;

	// State
	var mergeEditIDList;

	this.init = function()
	{
		$DownloadsMergeDialog = $('#DownloadsMergeDialog');

		$('#DownloadsMerge_Merge').click(merge);

		$DownloadsMergeDialog.on('hidden', function ()
		{
			Refresher.resume();
		});

		if (UISettings.setFocus)
		{
			$DownloadsMergeDialog.on('shown', function ()
			{
				$('#DownloadsMerge_Merge').focus();
			});
		}
	}

	this.showModal = function(nzbIdList, allGroups)
	{
		Refresher.pause();

		mergeEditIDList = [];
		$('#DownloadsMerge_Files').empty();
		for (var i = 0; i < allGroups.length; i++)
		{
			var group = allGroups[i];
			if (nzbIdList.indexOf(group.NZBID) > -1)
			{
				mergeEditIDList.push(group.NZBID);
				var html = '<table><tr><td width="18px" valign="top"><i class="icon-file" style="vertical-align:top;margin-top:2px;"></i></td><td>' +
					Util.formatNZBName(group.NZBName) + '</td></tr></table>';
				$('#DownloadsMerge_Files').append(html);
			}
		}

		$DownloadsMergeDialog.modal({backdrop: 'static'});
	}

	function merge()
	{
		RPC.call('editqueue', ['GroupMerge', 0, '', mergeEditIDList], completed);
	}

	function completed()
	{
		$DownloadsMergeDialog.modal('hide');
		Refresher.update();
		Notification.show('#Notif_Downloads_Merged');
	}
}(jQuery));


/*** DOWNLOAD SPLIT DIALOG ************************************************************/

var DownloadsSplitDialog = (new function($)
{
	'use strict'

	// Controls
	var $DownloadsSplitDialog;

	// State
	var splitEditIDList;

	this.init = function()
	{
		$DownloadsSplitDialog = $('#DownloadsSplitDialog');

		$('#DownloadsSplit_Split').click(split);

		$DownloadsSplitDialog.on('hidden', function ()
		{
			Refresher.resume();
		});

		if (UISettings.setFocus)
		{
			$DownloadsSplitDialog.on('shown', function ()
			{
				$('#DownloadsSplit_Merge').focus();
			});
		}
	}

	this.showModal = function(group, editIDList)
	{
		Refresher.pause();
		splitEditIDList = editIDList;
		var groupName = group.NZBName + ' (' + editIDList[0] + (editIDList.length > 1 ? '-' + editIDList[editIDList.length-1] : '') + ')';
		$('#DownloadsSplit_NZBName').attr('value', groupName);
		$DownloadsSplitDialog.modal({backdrop: 'static'});
	}

	function split()
	{
		var groupName = $('#DownloadsSplit_NZBName').val();
		RPC.call('editqueue', ['FileSplit', 0, groupName, splitEditIDList], completed);
	}

	function completed(result)
	{
		$('#DownloadsEditDialog').modal('hide');
		$DownloadsSplitDialog.modal('hide');
		Refresher.update();
		Notification.show(result ? '#Notif_Downloads_Splitted' : '#Notif_Downloads_SplitError');
	}
}(jQuery));


/*** EDIT HISTORY DIALOG *************************************************************************/

var HistoryEditDialog = (new function()
{
	'use strict'

	// Controls
	var $HistoryEditDialog;
	var $HistoryEdit_ParamData;
	var $ServStatsTable;

	// State
	var curHist;
	var notification = null;
	var postParams = [];
	var lastPage;
	var lastFullscreen;
	var saveCompleted;

	this.init = function()
	{
		$HistoryEditDialog = $('#HistoryEditDialog');
		$HistoryEdit_ParamData = $('#HistoryEdit_ParamData');

		$('#HistoryEdit_Save').click(saveChanges);
		$('#HistoryEdit_Delete').click(itemDelete);
		$('#HistoryEdit_Return, #HistoryEdit_ReturnURL').click(itemReturn);
		$('#HistoryEdit_Reprocess').click(itemReprocess);
		$('#HistoryEdit_Redownload').click(itemRedownload);
		$('#HistoryEdit_Param, #HistoryEdit_Dupe').click(tabClick);
		$('#HistoryEdit_Back').click(backClick);
		$('#HistoryEdit_MarkGood').click(itemGood);
		$('#HistoryEdit_MarkBad').click(itemBad);

		$ServStatsTable = $('#HistoryEdit_ServStatsTable');
		$ServStatsTable.fasttable(
			{
				filterInput: '#HistoryEdit_ServStatsTable_filter',
				pagerContainer: '#HistoryEdit_ServStatsTable_pager',
				pageSize: 100,
				maxPages: 3,
				hasHeader: true,
				renderCellCallback: EditUI.servStatsTableRenderCellCallback
			});

		$HistoryEditDialog.on('hidden', function ()
		{
			$HistoryEdit_ParamData.empty();
			// resume updates
			Refresher.resume();
		});

		TabDialog.extend($HistoryEditDialog);
	}

	this.showModal = function(hist)
	{
		Refresher.pause();

		curHist = hist;

		var status;
		if (hist.Kind === 'NZB')
		{
			status = '<span class="label label-status ' +
				(hist.Health === 1000 ? 'label-success' : hist.Health >= hist.CriticalHealth ? 'label-warning' : 'label-important') +
				'">health: ' + Math.floor(hist.Health / 10) + '%</span>';

			if (hist.MarkStatus !== 'NONE')
			{
				status += ' ' + buildStatus(hist.MarkStatus, 'Mark: ');
			}

			if (hist.DeleteStatus === 'NONE')
			{
				status += ' ' + buildStatus(hist.ParStatus, 'Par: ') +
					' ' + (Options.option('Unpack') == 'yes' || hist.UnpackStatus != 'NONE' ? buildStatus(hist.UnpackStatus, 'Unpack: ') : '')  +
					' ' + (hist.MoveStatus === "FAILURE" ? buildStatus(hist.MoveStatus, 'Move: ') : '');
			}
			else
			{
				status += ' ' + buildStatus('DELETED-' + hist.DeleteStatus, 'Delete: ');
			}

			for (var i=0; i<hist.ScriptStatuses.length; i++)
			{
				var scriptStatus = hist.ScriptStatuses[i];
				status += ' ' + buildStatus(scriptStatus.Status, Options.shortScriptName(scriptStatus.Name) + ': ') + ' ';
			}
		}
		else if (hist.Kind === 'URL')
		{
			if (hist.DeleteStatus !== 'NONE')
			{
				status = buildStatus('DELETED-' + hist.DeleteStatus, 'Delete: ');
			}
			else if (hist.UrlStatus == 'SCAN_SKIPPED')
			{
				status = buildStatus('SUCCESS', 'Fetch: ') + ' ' +
					buildStatus('SCAN_SKIPPED', 'Scan: ');
			}
			else if (hist.UrlStatus == 'SCAN_FAILURE')
			{
				status = buildStatus('SUCCESS', 'Fetch: ') + ' ' +
					buildStatus('FAILURE', 'Scan: ');
			}
			else
			{
				status = buildStatus(hist.UrlStatus, 'Fetch: ');
			}
		}
		else if (hist.Kind === 'DUP')
		{
			status = buildStatus(hist.DupStatus, '');
		}
		$('#HistoryEdit_Status').html(status);

		$('#HistoryEdit_Title').text(Util.formatNZBName(hist.Name));
		if (hist.Kind !== 'NZB')
		{
			$('#HistoryEdit_Title').html($('#HistoryEdit_Title').html() + '&nbsp;' + '<span class="label label-info">' +
				(hist.Kind === 'DUP' ? 'hidden' : hist.Kind) + '</span>');
		}

		if (hist.Kind !== 'DUP')
		{
			$('#HistoryEdit_Category').text(hist.Category);
		}

		if (hist.Kind === 'NZB')
		{
			$('#HistoryEdit_Path').text(hist.FinalDir !== '' ? hist.FinalDir : hist.DestDir);

			var size = Util.formatSizeMB(hist.FileSizeMB, hist.FileSizeLo);
			var completion = hist.SuccessArticles + hist.FailedArticles > 0 ? Util.round0(hist.SuccessArticles * 100.0 / (hist.SuccessArticles +  hist.FailedArticles)) + '%' : '--';

			var table = '';
			table += '<tr><td>Total</td><td class="text-right">' + size + '</td></tr>';
			table += '<tr><td>Files (total/parked)</td><td class="text-center">' + hist.FileCount + ' / ' + hist.RemainingFileCount + '</td></tr>';
			table += '<tr><td>' +
				(hist.ServerStats.length > 0 ? '<a href="#" id="HistoryEdit_ServStats" data-tab="HistoryEdit_ServStatsTab" title="Per-server statistics">' : '') +
				'Articles (total/completion)' +
				(hist.ServerStats.length > 0 ? ' <i class="icon-forward" style="opacity:0.6;"></i></a>' : '') +
				'</td><td class="text-center">' + hist.TotalArticles + ' / ' + completion + '</td></tr>';
			$('#HistoryEdit_Statistics').html(table);
			$('#HistoryEdit_ServStats').click(tabClick);
			EditUI.fillServStats($ServStatsTable, hist);
			$ServStatsTable.fasttable('setCurPage', 1);
		}

		$('#HistoryEdit_DupeKey').val(hist.DupeKey);
		$('#HistoryEdit_DupeScore').val(hist.DupeScore);
		$('#HistoryEdit_DupeMode').val(hist.DupeMode);
		$('#HistoryEdit_DupeBackup').prop('checked', hist.DeleteStatus === 'DUPE');
		$('#HistoryEdit_DupeBackup').prop('disabled', !(hist.DeleteStatus === 'DUPE' || hist.DeleteStatus === 'MANUAL'));
		Util.show($('#HistoryEdit_DupeBackup').closest('.control-group'), hist.Kind === 'NZB');
		$('#HistoryEdit_DupeMode').closest('.control-group').toggleClass('last-group', hist.Kind !== 'NZB');

		Util.show('#HistoryEdit_Return', hist.RemainingFileCount > 0);
		Util.show('#HistoryEdit_ReturnURL', hist.Kind === 'URL');
		Util.show('#HistoryEdit_Redownload', hist.Kind === 'NZB');
		Util.show('#HistoryEdit_PathGroup, #HistoryEdit_StatisticsGroup, #HistoryEdit_Reprocess', hist.Kind === 'NZB');
		Util.show('#HistoryEdit_CategoryGroup', hist.Kind !== 'DUP');
		Util.show('#HistoryEdit_DupGroup', hist.Kind === 'DUP');
		var dupeCheck = Options.option('DupeCheck') === 'yes';
		Util.show('#HistoryEdit_MarkGood', dupeCheck && ((hist.Kind === 'NZB' && hist.MarkStatus !== 'GOOD') || (hist.Kind === 'DUP' && hist.DupStatus !== 'GOOD')));
		Util.show('#HistoryEdit_MarkBad', dupeCheck && hist.Kind !== 'URL');
		Util.show('#HistoryEdit_Dupe', dupeCheck);
		$('#HistoryEdit_CategoryGroup').toggleClass('control-group-last', hist.Kind === 'URL');

		Util.show('#HistoryEdit_URLGroup', hist.Kind === 'URL');
		$('#HistoryEdit_URL').attr('value', hist.URL);

		var postParamConfig = ParamTab.createPostParamConfig();
		var postParam = hist.Kind === 'NZB' && postParamConfig[0].options.length > 0;
		Util.show('#HistoryEdit_Param', postParam);

		if (postParam)
		{
			postParams = ParamTab.buildPostParamTab($HistoryEdit_ParamData, postParamConfig, curHist.Parameters);
		}

		EditUI.buildDNZBLinks(curHist.Parameters ? curHist.Parameters : [], 'HistoryEdit_DNZB');

		enableAllButtons();

		$('#HistoryEdit_GeneralTab').show();
		$('#HistoryEdit_ParamTab').hide();
		$('#HistoryEdit_ServStatsTab').hide();
		$('#HistoryEdit_DupeTab').hide();
		$('#HistoryEdit_Back').hide();
		$('#HistoryEdit_BackSpace').show();
		$HistoryEditDialog.restoreTab();

		notification = null;

		$HistoryEditDialog.modal({backdrop: 'static'});
	}

	function buildStatus(status, prefix)
	{
		switch (status)
		{
			case 'SUCCESS':
			case 'GOOD':
				return '<span class="label label-status label-success">' + prefix + status + '</span>';
			case 'FAILURE':
				return '<span class="label label-status label-important">' + prefix + 'failure</span>';
			case 'BAD':
				return '<span class="label label-status label-important">' + prefix + status + '</span>';
			case 'REPAIR_POSSIBLE':
				return '<span class="label label-status label-warning">' + prefix + 'repairable</span>';
			case 'MANUAL': // PAR-MANUAL
			case 'SPACE':
			case 'PASSWORD':
				return '<span class="label label-status label-warning">' + prefix + status + '</span>';
			case 'DELETED-DUPE':
				return '<span class="label label-status">' + prefix + 'dupe</span>';
			case 'DELETED-MANUAL':
				return '<span class="label label-status">' + prefix + 'manual</span>';
			case 'DELETED-HEALTH':
				return '<span class="label label-status label-important">' + prefix + 'health</span>';
			case 'SCAN_SKIPPED':
				return '<span class="label label-status label-warning"">' + prefix + 'skipped</span>';
			case 'NONE':
				return '<span class="label label-status">' + prefix + 'none</span>';
			default:
				return '<span class="label label-status">' + prefix + status + '</span>';
		}
	}
	
	function tabClick(e)
	{
		e.preventDefault();

		$('#HistoryEdit_Back').fadeIn(500);
		$('#HistoryEdit_BackSpace').hide();
		var tab = '#' + $(this).attr('data-tab');
		lastPage = $(tab);
		lastFullscreen = ($(this).attr('data-fullscreen') === 'true') && !UISettings.miniTheme;

		$HistoryEditDialog.switchTab($('#HistoryEdit_GeneralTab'), lastPage,
			e.shiftKey || !UISettings.slideAnimation ? 0 : 500,
			{fullscreen: lastFullscreen, mini: UISettings.miniTheme});
	}

	function backClick(e)
	{
		e.preventDefault();
		$('#HistoryEdit_Back').fadeOut(500, function()
		{
			$('#HistoryEdit_BackSpace').show();
		});

		$HistoryEditDialog.switchTab(lastPage, $('#HistoryEdit_GeneralTab'),
			e.shiftKey || !UISettings.slideAnimation ? 0 : 500,
			{fullscreen: lastFullscreen, mini: UISettings.miniTheme, back: true});
	}

	function disableAllButtons()
	{
		$('#HistoryEditDialog .modal-footer .btn').attr('disabled', 'disabled');
		setTimeout(function()
		{
			$('#HistoryEdit_Transmit').show();
		}, 500);
	}

	function enableAllButtons()
	{
		$('#HistoryEditDialog .modal-footer .btn').removeAttr('disabled');
		$('#HistoryEdit_Transmit').hide();
	}

	function itemDelete(e)
	{
		e.preventDefault();
		HistoryUI.deleteConfirm(doItemDelete, curHist.Kind === 'NZB', curHist.Kind === 'DUP',
			curHist.ParStatus === 'FAILURE' || curHist.UnpackStatus === 'FAILURE', false);
	}

	function doItemDelete(command)
	{
		disableAllButtons();
		notification = '#Notif_History_Deleted';
		RPC.call('editqueue', [command, 0, '', [curHist.ID]], completed);
	}

	function itemReturn(e)
	{
		e.preventDefault();
		disableAllButtons();
		notification = '#Notif_History_Returned';
		RPC.call('editqueue', ['HistoryReturn', 0, '', [curHist.ID]], completed);
	}

	function itemRedownload(e)
	{
		e.preventDefault();
		if (curHist.SuccessArticles > 0)
		{
			ConfirmDialog.showModal('HistoryEditRedownloadConfirmDialog', doItemRedownload);
		}
		else
		{
			doItemRedownload();
		}
	}

	function doItemRedownload()
	{
		disableAllButtons();
		notification = '#Notif_History_Returned';
		RPC.call('editqueue', ['HistoryRedownload', 0, '', [curHist.ID]], completed);
	}

	function itemReprocess(e)
	{
		e.preventDefault();
		disableAllButtons();
		saveCompleted = reprocess;
		saveDupeKey();
	}

	function reprocess()
	{
		notification = '#Notif_History_Reproces';
		RPC.call('editqueue', ['HistoryProcess', 0, '', [curHist.ID]], completed);
	}

	function completed()
	{
		$HistoryEditDialog.modal('hide');
		Refresher.update();
		if (notification)
		{
			Notification.show(notification);
			notification = null;
		}
	}

	function saveChanges(e)
	{
		e.preventDefault();
		disableAllButtons();
		notification = null;
		saveCompleted = completed;
		saveDupeKey();
	}

	function itemGood(e)
	{
		e.preventDefault();
		ConfirmDialog.showModal('HistoryEditGoodConfirmDialog', doItemGood);
	}

	function doItemGood()
	{
		disableAllButtons();
		notification = '#Notif_History_Marked';
		RPC.call('editqueue', ['HistoryMarkGood', 0, '', [curHist.ID]], completed);
	}

	function itemBad(e)
	{
		e.preventDefault();
		ConfirmDialog.showModal('HistoryEditBadConfirmDialog', doItemBad);
	}

	function doItemBad()
	{
		disableAllButtons();
		notification = '#Notif_History_Marked';
		RPC.call('editqueue', ['HistoryMarkBad', 0, '', [curHist.ID]], completed);
	}

	/*** TAB: POST-PROCESSING PARAMETERS **************************************************/

	function saveParam()
	{
		if (curHist.Kind !== 'NZB')
		{
			saveCompleted();
			return;
		}

		var paramList = ParamTab.prepareParamRequest(postParams);
		saveNextParam(paramList);
	}

	function saveNextParam(paramList)
	{
		if (paramList.length > 0)
		{
			RPC.call('editqueue', ['HistorySetParameter', 0, paramList[0], [curHist.ID]], function()
			{
				notification = '#Notif_History_Saved';
				paramList.shift();
				saveNextParam(paramList);
			})
		}
		else
		{
			saveCompleted();
		}
	}

	/*** TAB: DUPLICATE SETTINGS **************************************************/

	function saveDupeKey()
	{
		var value = $('#HistoryEdit_DupeKey').val();
		value !== curHist.DupeKey ?
			RPC.call('editqueue', ['HistorySetDupeKey', 0, value, [curHist.ID]], function()
			{
				notification = '#Notif_History_Saved';
				saveDupeScore();
			})
			:saveDupeScore();
	}

	function saveDupeScore()
	{
		var value = $('#HistoryEdit_DupeScore').val();
		value != curHist.DupeScore ?
			RPC.call('editqueue', ['HistorySetDupeScore', 0, value, [curHist.ID]], function()
			{
				notification = '#Notif_History_Saved';
				saveDupeMode();
			})
			:saveDupeMode();
	}

	function saveDupeMode()
	{
		var value = $('#HistoryEdit_DupeMode').val();
		value !== curHist.DupeMode ?
			RPC.call('editqueue', ['HistorySetDupeMode', 0, value, [curHist.ID]], function()
			{
				notification = '#Notif_History_Saved';
				saveDupeBackup();
			})
			:saveDupeBackup();
	}

	function saveDupeBackup()
	{
		var canChange = curHist.DeleteStatus === 'DUPE' || curHist.DeleteStatus === 'MANUAL';
		var oldValue = curHist.DeleteStatus === 'DUPE';
		var value = $('#HistoryEdit_DupeBackup').is(':checked');
		canChange && value !== oldValue ?
			RPC.call('editqueue', ['HistorySetDupeBackup', 0, value ? "YES" : "NO", [curHist.ID]], function()
			{
				notification = '#Notif_History_Saved';
				saveParam();
			})
			:saveParam();
	}
}(jQuery));
