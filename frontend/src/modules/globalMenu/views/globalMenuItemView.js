// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
define(function(require) {

    var Origin = require('core/origin');

    var GlobalMenuItemView = Backbone.View.extend({

        className: 'global-menu-item',

        events: {
            'click a.global-menu-item-inner': 'onMenuItemClicked',
            'click button.global-menu-item-toggle': 'onToggleClicked'
        },

        initialize: function() {
            // Used to clean up view when closing the menu
            this.listenTo(Origin, 'globalMenu:globalMenuView:remove', this.remove);
            this.setupChildren();
            this.render();
        },

        render: function() {
            var data = this.model.toJSON();
            data.hasChildren = this.children.length > 0;
            data.submenuId = 'global-menu-children-' + this.cid;
            var template = Handlebars.templates[this.constructor.template];
            this.$el.html(template(data));
            this.childViews = this.children.map(function(model) {
                var view = new GlobalMenuItemView({ model: model, collection: this.collection });
                this.$('.global-menu-item-children').append(view.$el);
                return view;
            }, this);
            return this;
        },

        setupChildren: function() {
            // Find children subItems
            this.children = this.collection.where({parent: this.model.get('text')}).filter(function(item) {
                return item.get('location') === 'global' || item.get('location') === Origin.location.module;
            });

            // If this item has subItems return true else return false
            // This helps decide whether hover events get added or not
            if (this.children.length >= 1) {
                return true;
            } else {
                return false;
            }

        },

        onToggleClicked: function(event) {
            event.preventDefault();
            event.stopPropagation();
            this.isExpanded = !this.isExpanded;
            this.$('> .global-menu-item-toggle').attr('aria-expanded', String(this.isExpanded));
            this.$('> .global-menu-item-children').prop('hidden', !this.isExpanded);
        },

        onMenuItemClicked: function(event) {
            event.preventDefault();
            event.stopPropagation();
            // Set all active menu items to false
            this.collection.invoke('set', {"_isActive": false});
            // Trigger callback event
            Origin.trigger('globalMenu:' + this.model.get('callbackEvent'));
            // Trigger navigation toggle to close
            Origin.trigger('globalMenu:close');
        },

        remove: function() {
            _.invoke(this.childViews || [], 'remove');
            return Backbone.View.prototype.remove.apply(this, arguments);
        }

    }, {
        template: 'globalMenuItem'
    });

    return GlobalMenuItemView;

})