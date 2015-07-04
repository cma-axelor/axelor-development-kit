/*
 * Axelor Business Solutions
 *
 * Copyright (C) 2005-2015 Axelor (<http://axelor.com>).
 *
 * This program is free software: you can redistribute it and/or  modify
 * it under the terms of the GNU Affero General Public License, version 3,
 * as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
(function() {

"use strict";

var ui = angular.module('axelor.ui');

function BaseCardsCtrl(type, $scope, $element) {

	DSViewCtrl(type, $scope, $element);

	$scope.getRouteOptions = function() {
		return {
			mode: type,
			args: []
		};
	};

	$scope.setRouteOptions = function(options) {
		if (!$scope.isNested) {
			$scope.updateRoute();
		}
	};

	var ds = $scope._dataSource;
	var initialized = false;

	$scope.onShow = function (viewPromise) {

		if (initialized) {
			return;
		}

		initialized = true;

		viewPromise.then(function (meta) {
			$scope.parse(meta.fields, meta.view);
		});
	};

	$scope.parse = function (fields, view) {

	};

	$scope.onNew = function () {
		$scope.switchTo('form', function (formScope) {
			formScope.edit(null);
			formScope.setEditable();
			formScope.$broadcast("on:new");
		});
	};

	$scope.onRefresh = function () {
		$scope.filter({});
	};

	function update(records) {
		$scope.records = records;
	}

	$scope.filter = function(options) {
		var view = $scope.schema;
		var opts = {
			fields: _.pluck($scope.fields, 'name'),
		};

		if (options.criteria || options._domains) {
			opts.filter = options;
		}
		if (options.archived !== undefined) {
			opts.archived = options.archived;
		}
		if (view.orderBy) {
			opts.sortBy = view.orderBy.split(',');
		}

		return ds.search(opts).success(update);
	};

	$scope.pagerText = function() {
		var page = ds._page;
		if (page && page.from !== undefined) {
			if (page.total == 0) return null;
			return _t("{0} to {1} of {2}", page.from + 1, page.to, page.total);
		}
	};

	$scope.onNext = function() {
		var fields = _.pluck($scope.fields, 'name');
		return ds.next(fields).success(update);
	};

	$scope.onPrev = function() {
		var fields = _.pluck($scope.fields, 'name');
		return ds.prev(fields).success(update);
	};
}

ui.controller("CardsCtrl", ['$scope', '$element', function CardsCtrl($scope, $element) {

	BaseCardsCtrl('cards', $scope, $element);

	$scope.parse = function (fields, view) {
		$scope.onRefresh();
	}
}]);

ui.controller("KanbanCtrl", ['$scope', '$element', function KanbanCtrl($scope, $element) {

	BaseCardsCtrl('kanban', $scope, $element);

	$scope.parse = function (fields, view) {
		var columnBy = fields[view.columnBy] || {};
		var columns = _.map(columnBy.selectionList, function (item) {
			return item;
		});

		columns = _.first(columns, 6);

		var first = _.first(columns);
		if (view.onNew) {
			first.canCreate = true;
		}

		var sequenceBy = fields[view.sequenceBy] || {};
		if (["integer", "long"].indexOf(sequenceBy.type) === -1) {
			throw new Error("Invalid sequenceBy field in view: " + view.name);
		}

		$scope.columns = columns;
		$scope.colSpan = "span" + (12 / columns.length);
	};

	$scope.move = function (record, to, next, prev) {

		var view = $scope.schema;
		var rec = _.pick(record, "id", "version", view.sequenceBy);
		var ds = $scope._dataSource._new($scope._model);

		// update columnBy
		rec[view.columnBy] = to;

		// update sequenceBy
		var all = _.compact([prev, rec, next]);
		var offset = _.min(_.pluck(all, view.sequenceBy)) || 0;

		_.each(all, function (item, i) {
			item[view.sequenceBy] = offset + i;
		});

		return ds.saveAll(all).success(function (records) {
			_.each(all, function (item) {
				_.extend(item, ds.get(item.id));
			});
			record.version = rec.version;
		});
	};

	$scope.onRefresh = function () {
		$scope.$broadcast("on:refresh");
	};

	$scope.filter = function(searchFilter) {
		var options = {};
		if (searchFilter.criteria || searchFilter._domains) {
			options = {
				filter: searchFilter
			};
			if (searchFilter.archived !== undefined) {
				options.archived = searchFilter.archived;
			}
			$scope.$broadcast("on:filter", options);
		}
	};
}]);

ui.directive('uiKanban', function () {

	return function (scope, element, attrs) {

		function makeSortables() {
			element.find(".kanban-card-list").sortable({
				connectWith: ".kanban-card-list",
				items: ".kanban-card",
				tolerance: "pointer",
				stop: function (event, ui) {
					var item = ui.item;
					var column = item.parent().scope().column;
					var next = item.next().scope();
					var prev = item.prev().scope();

					if (next) next = next.record;
					if (prev) prev = prev.record;

					var source = $(this).scope();
					var target = item.parent().scope();
					var record = item.scope().record;

					if (source === target && item.index() === source.records.indexOf(record)) {
						return;
					}

					source.reorder();
					if (target !== source) {
						target.reorder();
					}

					scope.move(record, column.value, next, prev);
					scope.applyLater();
				}
			});
		}

		var unwatch = scope.$watch("columns", function (cols) {
			if (cols) {
				unwatch();
				unwatch = null;
				setTimeout(makeSortables);
			}
		});
	};
});

ui.directive('uiKanbanColumn', ["ActionService", function (ActionService) {

	return {
		scope: true,
		link: function (scope, element, attrs) {

			var ds = scope._dataSource._new(scope._model);
			var view = scope.schema;

			ds._context = _.extend({}, scope._dataSource._context);
			ds._context[view.columnBy] = scope.column.value;
			ds._page.limit = view.limit || 20;

			var domain = "self." + view.columnBy + " = :" + view.columnBy;
			ds._domain = ds._domain ? ds._domain + " AND " + domain : domain;

			scope.records = [];

			function fetch(options) {
				var opts = _.extend({
					offset: 0,
					sortBy: [view.sequenceBy]
				}, options);
				ds.search(opts).success(function (records) {
					scope.records = scope.records.concat(records);
				});
			}

			scope.hasMore = function () {
				var page = ds._page;
				var next = page.from + page.limit;
				return next < page.total;
			};

			scope.onMore = function () {
				var page = ds._page;
				var next = page.from + page.limit;
				if (next < page.total) {
					return fetch({
						offset: next
					});
				}
			};

			scope.reorder = function () {
				var items = [];
				element.find("li.kanban-card").each(function () {
					items.push($(this).scope().record);
				});
				scope.records = items;
			};

			var onNew = null;

			scope.getContext = function () {
				var ctx = _.extend({}, scope._context);
				ctx._value = scope.newItem;
				return ctx;
			};

			scope.newItem = null;
			scope.onCreate = function () {

				var rec = scope.record = {};
				var view = scope.schema;

				rec[view.columnBy] = scope.column.value;

				if (onNew === null) {
					onNew = ActionService.handler(scope, element, {
						action: view.onNew
					});
				}

				var ds = scope._dataSource;
				var promise = onNew.handle();
				promise.then(function () {
					ds.save(scope.record).success(function (rec) {
						scope.newItem = null;
						scope.records.unshift(rec);
					});
				});
			};

			scope.onEdit = function (record) {
				scope.switchTo('form', function (formScope) {
					if (formScope.canEdit()) {
						formScope.edit(record);
						formScope.setEditable();
					}
				});
			};

			scope.onDelete = function (record) {
				axelor.dialogs.confirm(_t("Do you really want to delete the selected record?"),
				function(confirmed) {
					if (!confirmed) {
						return;
					}
					ds.removeAll([record]).success(function(records, page) {
						var index = scope.records.indexOf(record);
						scope.records.splice(index, 1);
					});
				});
			};

			scope.$on("on:refresh", function (e) {
				scope.newItem = null;
				scope.records.length = 0;
				fetch();
			});

			scope.$on("on:filter", function (e, options) {
				scope.newItem = null;
				scope.records.length = 0;
				return fetch(options);
			});

			fetch();
		}
	};
}]);

ui.directive('uiCards', function () {

	return function (scope, element, attrs) {

		scope.onEdit = function (record, readonly) {
			scope.switchTo('form', function (formScope) {
				if (formScope.canEdit()) {
					formScope.edit(record);
					if (!readonly) {
						formScope.setEditable();
					}
				}
			});
		};

		scope.onDelete = function (record) {
			axelor.dialogs.confirm(_t("Do you really want to delete the selected record?"),
			function(confirmed) {
				if (!confirmed) {
					return;
				}
				ds.removeAll([record]).success(function(records, page) {
					var index = scope.records.indexOf(record);
					scope.records.splice(index, 1);
				});
			});
		};

		element.on("click", ".kanban-card", function (e) {
			if ($(e.target).parents(".kanban-card-menu").size()) {
				return;
			}
			var elem = $(this);
			var record = elem.scope().record;
			scope.onEdit(record, true);
			scope.applyLater();
		});
	};
});

ui.directive('uiCard', ["$parse", "$compile", function ($parse, $compile) {

	return {
		scope: true,
		link: function (scope, element, attrs) {

			var body = element.find(".kanban-card-body");
			var record = scope.record;
			var evalScope = scope.$new(true);

			evalScope.record = record;
			evalScope.getContext = scope.getContext = function () {
				var ctx = _.extend({}, scope._context, scope.record);
				ctx._model = scope._model;
				return ctx;
			};

			if (!record.$processed) {
				element.hide();
			}

			function process(record) {
				if (record.$processed) {
					return record;
				}
				record.$processed = true;
				for (var name in record) {
					if (!record.hasOwnProperty(name) || name.indexOf('.') === -1) {
						continue;
					}
					var nested = record;
					var names = name.split('.');
					var head = _.first(names, names.length - 1);
					var last = _.last(names);
					head.forEach(function (n) {
						nested = nested[n] || (nested[n] = {});
					});
					nested[last] = record[name];
				}
				return record;
			}

			evalScope.$watch("record", function (record) {
				_.extend(evalScope, process(record));
			}, true);

			evalScope.$image = function (fieldName, imageName) {
				var rec = scope.record;
				var v = rec.version || rec.$version || 0;
				if (fieldName === null && imageName) {
					return "ws/rest/" + scope._model + "/" + rec.id + "/" + imageName + "/download?image=true&v=" + v;
				}
				var field = scope.fields[fieldName];
				if (field && field.target && rec[fieldName]) {
					var val = rec[fieldName];
					return "ws/rest/" + field.target + "/" + val.id + "/" + imageName + "/download?image=true&v=" + v;
				}
				return "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
			};

			var template = (scope.schema.template || "<span></span>").trim();
			if (template.indexOf('<') !== 0) {
				template = "<span>" + template + "</span>";
			}

			scope.hilite = null;

			$compile(template)(evalScope).appendTo(body);

			var hilites = scope.schema.hilites || [];
			for (var i = 0; i < hilites.length; i++) {
				var hilite = hilites[i];
				var expr = $parse(hilite.condition);
				if (expr(scope.record)) {
					scope.hilite = hilite;
					break;
				}
			}

			if (scope.schema.cardWidth) {
				element.parent().css("width", scope.schema.cardWidth);
			}

			element.fadeIn("slow");
		}
	};
}]);

})();
